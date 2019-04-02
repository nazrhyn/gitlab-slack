'use strict';

/**
 * gitlab-slack configuration.
 * @typedef {Object} Configuration
 * @property {Number} port The port on which to listen.
 * @property {String} slackWebhookUrl The URL of the Slack incoming webhook.
 * @property {GitLabConfiguration} gitLab GitLab configuration.
 */

/**
 * gitlab-slack GitLab configuration.
 * @typedef {Object} GitLabConfiguration
 * @property {String} baseUrl The protocol/host/port of the GitLab installation.
 * @property {String} apiToken The API token with which to query GitLab.
 * @property {ProjectConfiguration[]} projects The project configuration.
 */

/**
 * gitlab-slack GitLab project configuration.
 * @typedef {Object} ProjectConfiguration
 * @property {Number} id The project ID.
 * @property {String} name The name of the project. This value is only used for logging; the group/name namespace is recommended.
 * @property {String} [channel] Overrides the default channel for the Slack webhook.
 * @property {Array<RegExp|String>} [patterns] An array of regular expressions or strings (that will be turned into case-insensitive regular expressions) used to select issue labels that should be tracked for changes.
 */

/**
 * The gitlab-slack configuration.
 * @type {Configuration}
 */
module.exports = {
	port: 4646,
	slackWebhookUrl: '',
	gitLab: {
		baseUrl: '',
		apiToken: '',
		projects: []
	}
};
