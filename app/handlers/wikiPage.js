'use strict';

const /**
	 * @type {Configuration}
	 */
	config = require('../../config'),
	debugCreate = require('debug'),
	helpers = require('../lib/helpers'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:wikipage');

/**
 * Handles an wiki page message.
 * @param {Object} data The message data.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = async function (data) {
	debug('Handling message...');

	const wikiDetails = data.object_attributes,
		verb = helpers.actionToVerb(wikiDetails.action),
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/u/%s|%s> %s wiki page <%s|%s>',
				data.project.path_with_namespace,
				config.gitLab.baseUrl,
				data.user.username,
				data.user.username,
				verb,
				wikiDetails.url,
				wikiDetails.slug
			)
		};

	debug('Message handled.');

	output.__kind = module.exports.KIND;

	return output;
};

/**
 * Provides metadata for this kind of handler.
 * @type {HandlerKind}
 */
module.exports.KIND = Object.freeze({
	name: 'wiki_page',
	title: 'Wiki Page'
});
