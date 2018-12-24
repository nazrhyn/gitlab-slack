'use strict';

const debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:job');

/**
 * Handles an wiki page message.
 * @param {Object} data The message data.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data) {
	debug('Handling message...');

	const wikiDetails = data.object_attributes,
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/jobs/%s| %s %s> by <%s/u/%s|%s> %s',
				data.project.name,
				data.project.web_url,
				wikiDetails.build_id,
				wikiDetails.build_name,
				wikiDetails.build_id,
				data.project.web_url,
				data.user.username,
				data.user.username,
				wikiDetails.build_status
			)
		};

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperties(
	module.exports,
	{
		KIND:
        {
         	enumerable: true,
        	value: Object.freeze({
        		name: 'build',
        		title: 'Build'
        	})
        },
		COLOR: {
			enumerable: true,
			value: '#31B93D'
		}
	}
);
