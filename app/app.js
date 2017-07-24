'use strict';

global._ = require('lodash');
global.Promise = require('bluebird');
global.path = require('path');

global.__paths = {
	base: path.join(__dirname, '../')
};
global.__paths.app = path.join(global.__paths.base, 'app');
global.__paths.lib = path.join(global.__paths.app, 'lib');
global.__paths.handlers = path.join(global.__paths.app, 'handlers');

global.config = require(path.join(global.__paths.base, 'config'));

const chalk = require('chalk'),
	debugCreate = require('debug'),
	{ GitLabApi } = require(path.join(global.__paths.lib, 'gitlabapi')),
	handlers = require(global.__paths.handlers),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	server = require(path.join(global.__paths.lib, 'server'));

const api = new GitLabApi(global.config.gitLab.baseUrl, global.config.gitLab.apiToken),
	debug = debugCreate('gitlab-slack:app');

let gitLabSlack;

process.on('uncaughtException', function (err) {
	debug(chalk`{red UNCAUGHT EXCEPTION} - ${err.message}${'\n'}${err.stack}`);
	process.exit(1);
});
process.on('SIGINT', function () {
	debug(chalk`{yellow SIGINT} received!`);
	return _terminate();
});
process.on('SIGTERM', function () {
	debug(chalk`{yellow SIGTERM} received!`);
	return _terminate();
});

Promise.config({
	longStackTraces: true
});

Promise.coroutine(function* () {
	debug('Starting up...');

	if (!global.config.gitLab.projects || !global.config.gitLab.projects.length) {
		debug('No projects defined in configuration. Terminating...');
		return;
	}

	// Be nice and add the # character to channels in project configuration if it's not there.
	for (const project of global.config.gitLab.projects) {
		if (project.channel && !project.channel.startsWith('#')) {
			project.channel = '#' + project.channel;
		}
	}

	const projectConfigs = new Map(_.map(global.config.gitLab.projects, p => [p.id, p])),
		{ labelColors, issueLabels } = yield _buildIssueLabelCaches();

	gitLabSlack = server.createServer(
		data => handlers.handleMessage(
			projectConfigs,
			labelColors,
			issueLabels,
			api,
			data
		)
	);

	gitLabSlack.on('close', function () {
		// If the service closes for some other reason, make sure
		//  the process also exits.
		_terminate();
	});

	gitLabSlack.listen(global.config.port);

	debug('Startup complete.');
})()
	.catch(function (err) {
		debug(chalk`{red ERROR} Processing failure in main branch. ! {red %s}${'\n'}     {blue Stack} %s`, err.message, err.stack);
		_terminate();
	});

// region ---- HELPER FUNCTIONS --------------------

/**
 * Caches project and issue labels for projects with label-tracking enabled.
 * @returns {Promise<{ projectLabelCaches: Map, issueLabelCaches: Map }>} The issue and label caches.
 * @private
 */
function _buildIssueLabelCaches() {
	const cachers = [],
		labelColors = new Map(),
		issueLabels = new Map();

	_.each(global.config.gitLab.projects, function (project) {
		// For the label patterns that aren't already regex, compile them.
		_.each(project.labels, function (label, index) {
			if (!_.isRegExp(label)) {
				project.labels[index] = new RegExp(label, 'i');
			}
		});

		if (_.size(project.labels)) {
			const cacher = Promise.coroutine(function* () {
				debug(chalk`{cyan CACHE}[{cyanBright %d}] Caching information for {blue %d} / {blue %s}...`, project.id, project.id, project.name || '<no-name>');

				// region ---- CACHE PROJECT LABEL COLORS --------------------

				const projectLabelColors = new Map(),
					projectLabels = yield api.getLabels(project.id);

				let projectLabelsCached = 0;

				// In API requests, labels have a name.
				for (const label of helpers.matchingAnyPattern(projectLabels, project.labels, l => l.name)) {
					projectLabelColors.set(label.name, label.color);
					projectLabelsCached++;
				}

				debug(chalk`{cyan CACHE}[{cyanBright %d}] Cached {blue %d} project label colors.`, project.id, projectLabelsCached);

				// endregion ---- CACHE PROJECT LABEL COLORS --------------------

				// region ---- CACHE PROJECT ISSUE LABELS --------------------

				const projectIssueLabels = new Map();

				let issueLabelsCached = 0,
					currentIssuePage = 1,
					totalIssuePages = 0;

				while (!totalIssuePages || currentIssuePage < totalIssuePages) {
					const result = yield api.getOpenIssues(project.id, currentIssuePage);

					if (!result.data.length) {
						break;
					}

					if (!totalIssuePages) {
						totalIssuePages = result.totalPages;
					}

					for (const issue of result.data) {
						// We cache if the issue has labels and they match any of our patterns.
						const matchingLabels = helpers.matchingAnyPattern(issue.labels, project.labels);

						if (issue.labels.length && matchingLabels.length) {
							projectIssueLabels.set(issue.id, matchingLabels);
							issueLabelsCached++;
						}
					}

					currentIssuePage++;
				}

				debug(chalk`{cyan CACHE}[{cyanBright %d}] Cached labels of {blue %d} issues.`, project.id, issueLabelsCached);

				// endregion ---- CACHE PROJECT ISSUE LABELS --------------------

				labelColors.set(project.id, projectLabelColors);
				issueLabels.set(project.id, projectIssueLabels);

				debug(chalk`{cyan CACHE}[{cyanBright %d}] Cached all issue and label information.`, project.id);
			});

			cachers.push(cacher());
		}
	});

	return Promise.all(cachers).return({ labelColors, issueLabels });
}

/**
 * Terminates the service.
 */
function _terminate() {
	debug('Terminating...');
	if (gitLabSlack && gitLabSlack.listening) {
		gitLabSlack.close(function () {
			process.exit(0);
		});
	} else {
		process.exit(0);
	}
}

// endregion ---- HELPER FUNCTIONS --------------------
