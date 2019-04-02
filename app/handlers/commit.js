'use strict';

const _ = require('lodash'),
	bluebird = require('bluebird'),
	chalk = require('chalk'),
	/**
	 * @type {Configuration}
	 */
	config = require('../../config'),
	debugCreate = require('debug'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:commit');

const MENTION_TYPE_PATHS = new Map([
		['#', '/issues/'],
		['!', '/merge_requests/']
	]),
	REGEX_ISSUE_MENTION = /#\d+/g,
	REGEX_MERGE_REQUEST_MENTION = /!\d+/g,
	REGEX_FIRST_LINE_ISSUE = /\s*\(?(?:#\d+(?:,\s*)?)+\)?/g,
	REGEX_FIRST_LINE_MERGE_REQUEST = /\s*\(?(?:!\d+(?:,\s*)?)+\)?/g;

/**
 * Handles an commit message.
 * @param {GitLabApi} api The GitLab API.
 * @param {Object} data The message data.
 * @param {Boolean} filterCommits Indicates whether the commits should be filtered. (default = false)
 * @returns {Promise<Object|undefined>} A promise that will be resolved with the output data structure.
 */
module.exports = async function (api, data, filterCommits = false) {
	debug('Handling message...');

	if (!data.commits.length) {
		debug(chalk`Ignored. {blue no commits}`);
		return;
	}

	// Reverse the commits list so that "more recent" stuff is on top for display.
	//  This is not reverse chronological.
	data.commits.reverse();

	if (filterCommits) {
		// If we're told to, we filter the commits down to only those made by the user who pushed.
		const filtered = [];

		for (let i = 0; i < data.commits.length; i++) {
			const commit = data.commits[i],
				commitAuthor = commit.author.email;

			if (data.user_email === commitAuthor) {
				filtered.push(commit);
			} else {
				break;
			}
		}

		if (!filtered.length) {
			// If the user pushed a new branch without making commits, for example, this filter
			//  step may have resulted in no commits. In that case, we don't send a notification.
			return;
		}

		data.commits = filtered;
	}

	// Try to find GitLab users for each commit user's email address.
	const commitUsers = await bluebird.map(data.commits, async function (commit) {
			const email = commit.author.email.toLowerCase(),
				users = await api.searchUsers(email);

			return _.find(users, user => user.email.toLowerCase() === email);
		}),
		/* eslint-disable camelcase */ // Required property naming.
		attachment = {
			color: module.exports.COLOR,
			mrkdwn_in: ['text']
		},
		output = {
			parse: 'none',
			text: util.format(
				'[%s:%s] <%s/u/%s|%s> pushed %s commits:',
				data.project.path_with_namespace,
				data.ref.replace('refs/heads/', ''),
				config.gitLab.baseUrl,
				data.user_username,
				data.user_username,
				data.total_commits_count
			),
			attachments: [attachment]
		},
		/* eslint-enable camelcase */
		attachmentFallbacks = [],
		attachmentTexts = [];

	_.each(data.commits, function (commit, index) {
		const commitUser = commitUsers[index],
			commitId = commit.id.substr(0, 8); // Use the first 8 characters of the commit hash.

		let message = commit.message.split(/(?:\r\n|[\r\n])/)[0], // Only print the first line; support all line ending types.
			commitUserName,
			mentions = [];

		const issueMentions = commit.message.match(REGEX_ISSUE_MENTION), // Find all issue mentions.
			mergeRequestMentions = commit.message.match(REGEX_MERGE_REQUEST_MENTION); // Find all merge request mentions.

		if (commitUser) {
			commitUserName = commitUser.username;
		} else {
			// If the username couldn't be resolved, use the email in its place.
			commitUserName = commit.author.email;
		}

		if (issueMentions) {
			// If there were issues, make sure each is only mentioned once.
			mentions.push(..._.uniq(issueMentions));

			// Make sure the first line doesn't have any issue mentions left or that would be redundant.
			REGEX_FIRST_LINE_ISSUE.lastIndex = 0;
			message = message.replace(REGEX_FIRST_LINE_ISSUE, '');
		}

		if (mergeRequestMentions) {
			// If there were merge requests, make sure each is only mentioned once.
			mentions.push(..._.uniq(mergeRequestMentions));

			// Make sure the first line doesn't have any merge request mentions left or that would be redundant.
			REGEX_FIRST_LINE_MERGE_REQUEST.lastIndex = 0;
			message = message.replace(REGEX_FIRST_LINE_MERGE_REQUEST, '');
		}

		attachmentFallbacks.push(util.format(
			'[%s] %s: %s',
			commitUserName,
			commitId,
			message + (mentions.length ? ` (${mentions.join(', ')})` : '')
		));

		if (mentions) {
			// If there were mentions, build the formatted suffix here.
			mentions = _.map(mentions, function (mention) {
				return util.format(
					'<%s|%s>',
					data.project.web_url + MENTION_TYPE_PATHS.get(mention[0]) + mention.substr(1),
					mention
				);
			});
		}

		attachmentTexts.push(util.format(
			'[%s] <%s|%s>: %s',
			commitUserName,
			commit.url,
			commitId,
			message + (mentions.length ? ` (${mentions.join(', ')})` : '')
		));
	});

	attachment.fallback = attachmentFallbacks.join('\n');
	attachment.text = attachmentTexts.join('\n');

	debug('Message handled.');

	output.__kind = module.exports.KIND;

	return output;
};

/**
 * Provides metadata for this kind of handler.
 * @type {HandlerKind}
 */
module.exports.KIND = Object.freeze({
	name: 'push',
	title: 'Commit'
});

/**
 * The color for this kind of handler.
 * @type {string}
 */
module.exports.COLOR = '#1B6EB1';
