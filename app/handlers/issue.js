'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:issue');

/**
 * Adds an attachment for each of the labels.
 * @param {Map} projectLabelColors The label-to-color map for the project.
 * @param {Array} attachments The attachments array.
 * @param {String} action The action.
 * @param {String[]} labels The labels.
 */
function _addLabelChangeAttachments(projectLabelColors, attachments, action, labels) {
	for (const label of labels) {
		attachments.push({
			fallback: util.format('%s label %s', action, label),
			text: util.format('_%s_ label *%s*', action, label),
			color: projectLabelColors.get(label),
			mrkdwn_in: ['text']
		});
	}
}

/**
 * Handles an issue message.
 * @param {Map} projectConfigs A map of project ID to project configuration.
 * @param {Map} projectLabelCaches A map of project ID to a map of labels to label colors.
 * @param {Map} issueLabelCaches A map of project ID to a map of issue ID to issue labels.
 * @param {GitLabApi} api The GitLab API.
 * @param {Object} data The message data.
 * @returns {Promise<Object|undefined>} A promise that will be resolved with the output data structure.
 */
module.exports = Promise.coroutine(function* (projectConfigs, labelColors, issueLabels, api, data) {
	debug('Handling message...');

	const issueDetails = data.object_attributes,
		projectConfig = projectConfigs.get(issueDetails.project_id),
		projectLabelsTracked = !!projectConfig && !!_.size(projectConfig.labels),
		assignee = data.assignees && data.assignees[0], // If assigned, take the first; otherwise, it'll be undefined.
		author = yield api.getUserById(issueDetails.author_id);

	let milestone;

	if (issueDetails.milestone_id) {
		milestone = yield api.getMilestone(issueDetails.project_id, issueDetails.milestone_id);
	}

	let projectLabelColors, projectIssueLabels, matchingIssueLabels, addedLabels, removedLabels;

	if (projectLabelsTracked) {
		projectLabelColors = labelColors.get(issueDetails.project_id);
		projectIssueLabels = issueLabels.get(issueDetails.project_id);

		if (['open', 'reopen', 'update'].includes(issueDetails.action)) {
			// If this is open, reopen or update and there are labels tracked for this project,
			//  make sure we care about it before we do anything else.

			if (issueDetails.action === 'update' && issueDetails.state === 'closed') {
				// Sometimes GitLab generates an update event after the issue has been closed; if it does,
				//  we want to just ignore that.
				debug(chalk`Ignored. ({blue extraneous update})`);
				return;
			}

			const projectLabels = [...projectLabelColors.keys()],
				cachedIssueLabels = projectIssueLabels.get(issueDetails.id);

			// In issue webhooks, labels are full objects and have a title.
			matchingIssueLabels = _.map(helpers.matchingAnyPattern(data.labels, projectConfig.labels, l => l.title), 'title');

			addedLabels = _.chain(matchingIssueLabels) // Difference between the new label set...
				.difference(cachedIssueLabels) // ...and the old label set...
				.intersection(projectLabels) // ...intersected with what we care about.
				.value();

			// Same as above but as difference between old and new.
			removedLabels = _.chain(cachedIssueLabels)
				.difference(matchingIssueLabels)
				.intersection(projectLabels)
				.value();

			if (issueDetails.action === 'update' && _.size(addedLabels) + _.size(removedLabels) === 0) {
				// If there is no label difference for an update, we do not continue.
				debug(chalk`Ignored. ({blue no-changes update})`);
				return;
			}
		}
	} else if (issueDetails.action === 'update') {
		// If there's no label tracking going on, always ignore updates.
		debug(chalk`Ignored. ({blue no-track update})`);
		return;
	}

	const verb = helpers.actionToVerb(issueDetails.action);

	let assigneeName = '_none_',
		milestoneName = '_none_';

	if (assignee) {
		assigneeName = util.format('<%s/u/%s|%s>', global.config.gitLab.baseUrl, assignee.username, assignee.username);
	}

	if (milestone) {
		milestoneName = util.format('<%s/milestones/%s|%s>', data.project.web_url, milestone.iid, milestone.title);
	}

	const text = util.format(
			'[%s] <%s/u/%s|%s> %s issue *#%s* — *assignee:* %s — *milestone:* %s — *creator:* <%s/u/%s|%s>',
			data.repository.name,
			global.config.gitLab.baseUrl,
			data.user.username,
			data.user.username,
			verb,
			issueDetails.iid,
			assigneeName,
			milestoneName,
			global.config.gitLab.baseUrl,
			author.username,
			author.username
		),
		output = {
			text,
			attachments: []
		},
		mainAttachment = {
			fallback: util.format(
				'#%s %s',
				issueDetails.iid,
				issueDetails.title
			),
			title: issueDetails.title.replace('<', '&lt;').replace('>', '&gt;'), // Allow people use < & > in their titles.
			title_link: issueDetails.url,
			color: module.exports.COLOR,
			mrkdwn_in: ['title', 'text']
		};

	// Add the main attachment; all action types include some form of this.
	output.attachments.push(mainAttachment);

	switch (issueDetails.action) {
		case 'open':
		case 'reopen':
			// Open and re-open are the only ones that get the full issue description.
			mainAttachment.fallback += '\n' + issueDetails.description;
			mainAttachment.text = helpers.convertMarkdownToSlack(issueDetails.description, data.project.web_url);

			break;
	}

	if (projectLabelsTracked) {
		// This switch handles the label tracking management and reporting stuff.
		switch (issueDetails.action) {
			case 'open':
			case 'reopen':
			case 'update':
				_addLabelChangeAttachments(projectLabelColors, output.attachments, 'Added', addedLabels);
				_addLabelChangeAttachments(projectLabelColors, output.attachments, 'Removed', removedLabels);

				// Now, update the cache to the current state of affairs.
				projectIssueLabels.set(issueDetails.id, matchingIssueLabels);
				break;
			case 'close':
				// When issues are closed, we remove them from the cache.
				projectIssueLabels.delete(issueDetails.id);
				break;
		}
	}

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	return output;
});

Object.defineProperties(
	module.exports,
	{
		KIND: {
			enumerable: true,
			value: Object.freeze({
				name: 'issue',
				title: 'Issue'
			})
		},
		COLOR: {
			enumerable: true,
			value: '#F28A2B'
		}
	}
);
