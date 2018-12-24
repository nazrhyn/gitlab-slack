'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	rp = require('request-promise'),
	slack = require(path.join(global.__paths.lib, 'slack')),
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
 * Handles an incoming message.
 * @param {Map} projectConfigs A map of project ID to project configuration.
 * @param {Map} projectLabelCaches A map of project ID to a map of labels to label colors.
 * @param {Map} issueLabelCaches A map of project ID to a map of issue ID to issue labels.
 * @param {GitLabApi} api The GitLab API.
 * @param {Object} data The message data.
 * @returns {Promise} A promise that will be resolved when the message was handled.
 */
exports.handleMessage = Promise.coroutine(function* (projectConfigs, labelColors, issueLabels, api, data) {
	let outputs;

	if (data.object_kind) {
		// Both tags and commits have before/after values that need to be examined.
		const beforeZero = REGEX_ALL_ZEROES.test(data.before),
			afterZero = REGEX_ALL_ZEROES.test(data.after);

		switch (data.object_kind) {
			case handleIssue.KIND.name:
				outputs = yield handleIssue(projectConfigs, labelColors, issueLabels, api, data);
				break;
			case handleBranch.KIND.name:
			case handleCommit.KIND.name: {
				if (beforeZero || afterZero) {
					// If before or after is all zeroes, this is a branch being pushed.
					outputs = yield handleBranch(data, beforeZero, afterZero);

					if (beforeZero) {
						// If before is zero, it's a new branch; we also want to handle any
						//  commits that came with it.
						outputs = [outputs, yield handleCommit(api, data)];
					}
				} else {
					outputs = yield handleCommit(api, data);
				}
				break;
			}
			case handleTag.KIND.name:
				outputs = yield handleTag(data, beforeZero, afterZero);
				break;
			case handleMergeRequest.KIND.name:
				outputs = yield handleMergeRequest(data);
				break;
			case handleWikiPage.KIND.name:
				outputs = yield handleWikiPage(data);
				break;
			case handlePipelinePage.KIND.name:
				outputs = yield handlePipelinePage(data);
				break;
			case handleBuildPage.KIND.name:
				outputs = yield handleBuildPage(data);
				break;
			default:
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
		console.log(chalk`{cyanBright IGNORED} {yellow Message Body ---------------------}`, '\n', util.inspect(data, { colors: true, depth: 5 }));
		return;
	}

	const projectId = yield helpers.getProjectId(data, api),
		projectConfig = projectConfigs.get(projectId);

	if (projectConfig && projectConfig.channel) {
		// If we can assign the message to a configured project and that project has a channel,
		//  make sure all outgoing messages go to the configured channel.
		for (const output of outputs) {
			output.channel = projectConfig.channel;
		}
	}

	// Send all the outputs to Slack and we're done.
	yield Promise.map(outputs, output => slack.send(output));
});
