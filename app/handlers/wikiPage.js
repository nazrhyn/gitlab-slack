'use strict';

const debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:wikipage');

/**
 * Handles an wiki page message.
 * @param {Object} data The message data.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data) {
	debug('Handling message...');

	const wikiDetails = data.object_attributes,
		verb = helpers.actionToVerb(wikiDetails.action),
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/u/%s|%s> %s wiki page <%s|%s>',
				data.project.path_with_namespace.split('/')[1],
				global.config.gitLab.baseUrl,
				data.user.username,
				data.user.username,
				verb,
				wikiDetails.url,
				wikiDetails.slug
			)
		};

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperty(
	module.exports,
	'KIND',
	{
		enumerable: true,
		value: Object.freeze({
			name: 'wiki_page',
			title: 'Wiki Page'
		})
	}
);
