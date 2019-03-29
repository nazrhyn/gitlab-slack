'use strict';

const _ = require('lodash'),
	chalk = require('chalk'),
	/**
	 * @type {Configuration}
	 */
	config = require('../config'),
	debugCreate = require('debug'),
	{ GitLabApi } = require('./lib/gitlabapi'),
	handlers = require('./handlers'),
	helpers = require('./lib/helpers'),
	bluebird = require('bluebird'),
	server = require('./lib/server');

const api = new GitLabApi(config.gitLab.baseUrl, config.gitLab.apiToken),
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

bluebird.config({
	longStackTraces: true
});

(async function () {
	debug('Starting up...');

	if (!config.gitLab.projects || !config.gitLab.projects.length) {
		// Make sure this gets logged somehow.
		(debug.enabled ? debug : console.error)(chalk`{red ERROR} No projects defined in configuration. Terminating...`);
		process.exit(1);
	}

	// Be nice and add the # character to channels in project configuration if it's not there.
	for (const project of config.gitLab.projects) {
		if (project.channel && !project.channel.startsWith('#')) {
			project.channel = '#' + project.channel;
		}
	}

	const projectConfigs = new Map(_.map(config.gitLab.projects, p => [p.id, p])),
		{ labelColors, issueLabels } = await _buildIssueLabelCaches();

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

	gitLabSlack.listen(config.port);

	debug('Startup complete.');
})()
	.catch(function (err) {
		// Make sure this gets logged somehow.
		(debug.enabled ? debug : console.error)(chalk`{red ERROR} Processing failure in main branch. ! {red %s}\n{blue Stack} %s`, err.message, err.stack);
		_terminate(1);
	});

// region ---- HELPER FUNCTIONS --------------------

/**
 * Caches project and issue labels for projects with label-tracking enabled.
 * @returns {Promise<{ labelColors: Map, issueLabels: Map }>} The issue and label caches.
 * @private
 */
async function _buildIssueLabelCaches() {
	const cachers = [],
		issueLabels = new Map(),
		labelColors = new Map();

	_.each(config.gitLab.projects, function (project) {
		// For the label patterns that aren't already regex, compile them.
		_.each(project.labels, function (label, index) {
			if (!_.isRegExp(label)) {
				project.labels[index] = new RegExp(label, 'i');
			}
		});

		if (_.size(project.labels)) {
			const cacher = async function buildProjectCache() {
				debug(chalk`{cyan CACHE}[{cyanBright %d}] Caching information for {blue %d} / {blue %s}...`, project.id, project.id, project.name || '<no-name>');

				// region ---- CACHE PROJECT LABEL COLORS --------------------

				const projectLabelColors = new Map(),
					projectLabels = await api.getLabels(project.id);

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
					const result = await api.getOpenIssues(project.id, currentIssuePage);

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
			};

			cachers.push(cacher());
		}
	});

	await Promise.all(cachers);

	return { labelColors, issueLabels };
}

/**
 * Terminates the service.
 * @param {Number} exitCode The exit code. (default = 0)
 */
function _terminate(exitCode = 0) {
	debug('Terminating...');
	if (gitLabSlack && gitLabSlack.listening) {
		gitLabSlack.close(function () {
			process.exit(exitCode);
		});
	} else {
		process.exit(exitCode);
	}
}

// endregion ---- HELPER FUNCTIONS --------------------
