'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:commit');

const REGEX_ISSUE_MENTION = /#\d+/g,
	REGEX_FIRST_LINE_ISSUE = /\s*\(?(?:#\d+(?:,\s*)?)+\)?/g;

/**
 * Handles an commit message.
 * @param {GitLabApi} api The GitLab API.
 * @param {Object} data The message data.
 * @returns {Promise<Object|undefined>} A promise that will be resolved with the output data structure.
 */
module.exports = Promise.coroutine(function* (api, data) {
	debug('Handling message...');

	if (!data.commits.length) {
		debug(chalk`Ignored. {blue no commits}`);
		return;
	}

	// Reverse the commits list so that "more recent" stuff is on top for display.
	//  This is not reverse chronological.
	data.commits.reverse();

	// Try to find GitLab users for each commit user's email address.
	const commitUsers = yield Promise.map(data.commits, function (commit) {
			const email = commit.author.email.toLowerCase();

			return api.searchUsers(email)
				.then(function (users) {
					return _.find(users, user => user.email.toLowerCase() === email);
				});
		}),
		attachment = {
			color: module.exports.COLOR,
			mrkdwn_in: ['text']
		},
		output = {
			parse: 'none',
			text: util.format(
				'[%s:%s] <%s/u/%s|%s> pushed %s commits:',
				data.repository.name,
				data.ref.substr(data.ref.lastIndexOf('/') + 1),
				global.config.gitLab.baseUrl,
				data.user_username,
				data.user_username,
				data.total_commits_count
			),
			attachments: [attachment]
		},
		attachmentFallbacks = [],
		attachmentTexts = [];

	_.each(data.commits, function (commit, index) {
		const commitUser = commitUsers[index],
			commitId = commit.id.substr(0, 8); // Use the first 8 characters of the commit hash.

		let message = commit.message.split(/(?:\r\n|[\r\n])/)[0], // Only print the first line; support all line ending types.
			commitUserName,
			issueMentions = commit.message.match(REGEX_ISSUE_MENTION), // Find all issue mentions.
			issuesSuffix = '';

		if (commitUser) {
			commitUserName = commitUser.username;
		} else {
			// If the username couldn't be resolved, use the email in its place.
			commitUserName = commit.author.email;
		}

		if (issueMentions) {
			// If there were issues, make sure each issue is only mentioned once...
			issueMentions = _.uniq(issueMentions);

			// ... and then build the fallback suffix.
			issuesSuffix = ' (' + issueMentions.join(', ') + ')';

			// Make sure the first line doesn't have any issue mentions left or that would be redundant.
			REGEX_FIRST_LINE_ISSUE.lastIndex = 0;
			message = message.replace(REGEX_FIRST_LINE_ISSUE, '');
		}

		attachmentFallbacks.push(util.format(
			'[%s] %s: %s',
			commitUserName,
			commitId,
			message + issuesSuffix
		));

		if (issueMentions) {
			// If there were issues, build the formatted suffix here.
			issueMentions = _.map(issueMentions, function (issue) {
				return util.format(
					'<%s|%s>',
					data.repository.homepage + '/issues/' + issue.substr(1),
					issue
				);
			});

			issuesSuffix = ' (' + issueMentions.join(', ') + ')';
		}

		attachmentTexts.push(util.format(
			'[%s] <%s|%s>: %s',
			commitUserName,
			commit.url,
			commitId,
			message + issuesSuffix
		));
	});

	attachment.fallback = attachmentFallbacks.join('\n');
	attachment.text = attachmentTexts.join('\n');

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
				name: 'push',
				title: 'Commit'
			})
		},
		COLOR: {
			enumerable: true,
			value: '#1B6EB1'
		}
	}
);
