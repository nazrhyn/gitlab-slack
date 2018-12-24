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
				data.repository.name,
				data.repository.homepage,
				data.build_id,
				data.build_name,
				data.build_id,
				data.repository.homepage,
				data.user.name,
				data.user.name,
				data.build_status
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
