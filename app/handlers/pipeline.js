'use strict';

const debugCreate = require('debug'),
	helpers = require(path.join(global.__paths.lib, 'helpers')),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:pipeline');

/**
 * Handles an wiki page message.
 * @param {Object} data The message data.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data) {
	debug('Handling message...');

    const attachment = {
        mrkdwn_in: ['text'],
        color: module.exports.COLOR,
        title: data.commit.message,
        title_link: data.commit.url
    };

	const wikiDetails = data.object_attributes,
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/pipelines/%s|pipeline %s> by <%s/u/%s|%s> %s',
                data.project.name,
				data.project.web_url,
                wikiDetails.id,
                wikiDetails.id,
				data.project.web_url,
				data.user.username,
                data.user.username,
                wikiDetails.status
            ),
            attachments: [attachment]
		};

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperty(
    module.exports,
    {
        'KIND':
        {
            enumerable: true,
            value: Object.freeze({
                name: 'pipeline',
                title: 'pipeline'
            })
        },
        'COLOR': {
            enumerable: true,
            value: '#31B93D'
        }
    }
);
