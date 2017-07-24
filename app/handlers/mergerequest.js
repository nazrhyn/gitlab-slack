'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:mergerequest');

/**
 * Handles an merge request message.
 * @param {Object} data The message data.
 * @returns {Promise<Object|undefined>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data) {
	debug('Handling message...');

	const mergeRequestDetails = data.object_attributes;

	if (mergeRequestDetails.action === 'update') {
		// We always ignore updates as they're too spammy.
		debug(chalk`Ignored. ({blue update})`);
		return Promise.resolve();
	}

	const verb = helpers.actionToVerb(mergeRequestDetails.action),
		description = mergeRequestDetails.description.split(/(?:\r\n|[\r\n])/)[0], // Take only the first line of the description.
		attachment = {
			mrkdwn_in: ['text'],
			color: module.exports.COLOR,
			title: mergeRequestDetails.title,
			title_link: mergeRequestDetails.url
		};

	let assigneeName = '_none_';

	if (data.assignee) {
		assigneeName = util.format('<%s/u/%s|%s>', global.config.gitLab.baseUrl, data.assignee.username, data.assignee.username);
	}

	const output = {
		parse: 'none',
		text: util.format(
			'[%s] <%s/u/%s|%s> %s merge request *!%s* — *source:* <%s/tree/%s|%s> — *target:* <%s/tree/%s|%s> - *assignee* - %s',
			data.repository.name,
			global.config.gitLab.baseUrl,
			data.user.username,
			data.user.username,
			verb,
			mergeRequestDetails.iid,
			global.config.gitLab.baseUrl,
			mergeRequestDetails.source_branch,
			mergeRequestDetails.source_branch,
			global.config.gitLab.baseUrl,
			mergeRequestDetails.target_branch,
			mergeRequestDetails.target_branch,
			assigneeName
		),
		attachments: [attachment]
	};

	// Start the fallback with the title.
	attachment.fallback = attachment.title;

	switch (mergeRequestDetails.action) {
		case 'open':
		case 'reopen':
			// Open and re-open are the only ones that get the full merge request description.
			attachment.fallback += '\n' + mergeRequestDetails.description;
			attachment.text = helpers.convertMarkdownToSlack(description, mergeRequestDetails.source.web_url);

			break;
	}

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperties(
	module.exports,
	{
		KIND: {
			enumerable: true,
			value: Object.freeze({
				name: 'merge_request',
				title: 'Merge Request'
			})
		},
		COLOR: {
			enumerable: true,
			value: '#31B93D'
		}
	}
);
