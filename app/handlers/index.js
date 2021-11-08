'use strict';

const _ = require('lodash'),
	bluebird = require('bluebird'),
	chalk = require('chalk'),
	debugCreate = require('debug'),
	helpers = require('../lib/helpers'),
	slack = require('../lib/slack'),
	supportsColor = require('supports-color'),
	util = require('util');

const handleIssue = require(path.join(global.__paths.handlers, 'issue')),
	handleBranch = require(path.join(global.__paths.handlers, 'branch')),
	handleCommit = require(path.join(global.__paths.handlers, 'commit')),
	handleTag = require(path.join(global.__paths.handlers, 'tag')),
	handleMergeRequest = require(path.join(global.__paths.handlers, 'mergeRequest')),
	handleWikiPage = require(path.join(global.__paths.handlers, 'wikiPage')),
	handlePipelinePage = require(path.join(global.__paths.handlers, 'pipeline')),
	handleBuildPage = require(path.join(global.__paths.handlers, 'build'));

const debug = debugCreate('gitlab-slack:handler');

const REGEX_ALL_ZEROES = /^0+$/;

/**
 * The kind metadata.
 * @typedef {Object} HandlerKind
 * @property {String} name The internal name.
 * @property {String} title The display title.
 */

/**
 * Handles an incoming message.
 * @param {Map} projectConfigs A map of project ID to project configuration.
 * @param {Map} labelColors A map of project ID to a map of labels to label colors.
 * @param {Map} issueLabels A map of project ID to a map of issue ID to issue labels.
 * @param {GitLabApi} api The GitLab API.
 * @param {Object} data The message data.
 * @returns {Promise} A promise that will be resolved when the message was handled.
 */
exports.handleMessage = async function (projectConfigs, labelColors, issueLabels, api, data) {
	let outputs;

	if (data.object_kind) {
		// Both tags and commits have before/after values that need to be examined.
		const beforeZero = REGEX_ALL_ZEROES.test(data.before),
			afterZero = REGEX_ALL_ZEROES.test(data.after);

		switch (data.object_kind) {
			case handleIssue.KIND.name:
				outputs = await handleIssue(projectConfigs, labelColors, issueLabels, api, data);
				break;
			case handleBranch.KIND.name:
			case handleCommit.KIND.name: {
				if (beforeZero || afterZero) {
					// If before or after is all zeroes, this is a branch being pushed.
					outputs = await handleBranch(data, beforeZero, afterZero);

					if (beforeZero) {
						// If before is zero, it's a new branch; we also want to handle any
						//  commits that came with it. We tell the commit handler to filter
						//  the commits so that we don't include commits irrelevant to this push.
						outputs = [outputs, await handleCommit(api, data, true)];
					}
				} else {
					outputs = await handleCommit(api, data);
				}
				break;
			}
			case handleTag.KIND.name:
				outputs = await handleTag(data, beforeZero, afterZero);
				break;
			case handleMergeRequest.KIND.name:
				outputs = await handleMergeRequest(data);
				break;
			case handleWikiPage.KIND.name:
				outputs = await handleWikiPage(data);
				break;
			case handlePipelinePage.KIND.name:
				outputs = yield handlePipelinePage(data);
				break;
			case handleBuildPage.KIND.name:
				outputs = yield handleBuildPage(data);
				break;
			default:
				/* eslint-disable camelcase */ // Required property naming.
				// Unhandled/unrecognized messages go to the default channel for the webhook
				//  as a kind of notification that something unexpected came through.
				outputs = {
					parse: 'none',
					attachments: [{
						title: 'GitLab Webhook - Unrecognized Data',
						fallback: '(cannot display JSON unformatted)',
						text: '```' + JSON.stringify(data, null, 4) + '```',
						color: 'danger',
						mrkdwn_in: ['text']
					}]
				};
				/* eslint-enable camelcase */
				break;
		}
	}

	if (!_.isArray(outputs)) {
		outputs = [outputs];
	}

	outputs = _.compact(outputs);

	if (!outputs.length) {
		// If we get here and there's nothing to output, that means none of the handlers processed the message.
		debug(chalk`{cyanBright IGNORED} No handler processed the message.`);
		console.log(chalk`{cyanBright IGNORED} {yellow Message Body ---------------------}`, '\n', util.inspect(data, { colors: supportsColor.stdout.level > 0, depth: 5 }));
		return;
	}

	const projectId = await helpers.getProjectId(data, api),
		projectConfig = projectConfigs.get(projectId);

	if (projectConfig && projectConfig.channel) {
		// If we can assign the message to a configured project and that project has a channel,
		//  make sure all outgoing messages go to the configured channel.
		for (const output of outputs) {
			output.channel = projectConfig.channel;
		}
	}

	// Send all the outputs to Slack and we're done.
	await bluebird.map(outputs, output => slack.send(output));
};
