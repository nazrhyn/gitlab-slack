'use strict';

module.exports = {
	port: 4646,
	slackWebhookUrl: '',
	gitLab: {
		baseUrl: '',
		apiToken: '',
		projects: [
			/*
			{
				id: <Number project-id>,
				// The name is only used for logging purposes; the group/name namespace is recommended.
				name: <String name>,
				// Overrides the default channel for the Slack webhook; The # prefix is added if it is not present.
				channel: <String channel>,
				// An array of patterns that determines what issue labels should be tracked for changes.
				labels: <Array<RegExp|String> patterns>
			}
			*/
		]
	}
};
