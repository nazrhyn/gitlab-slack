'use strict';

const _ = require('lodash'),
	chalk = require('chalk'),
	debugCreate = require('debug'),
	http = require('http'),
	rp = require('request-promise'),
	util = require('util');

const API_BASE_ROUTE = '/api/v4',
	ROUTE_PARAM_PATTERN = /:([^/:]+)/g;

const debug = debugCreate('gitlab-slack:api');

/**
 * Defines a wrapper for the GitLab API.
 */
class GitLabApi {
	/**
	 * Creates an instance of `GitLabApi`.
	 * @param {String} baseUrl The API base URL.
	 * @param {String} token The API token.
	 */
	constructor(baseUrl, token) {
		this._baseUrl = baseUrl + API_BASE_ROUTE;
		this._token = token;
	}

	/**
	 * Gets user information by ID.
	 * @param {String|Number} userId The user ID.
	 * @returns {Promise} A promise that will be resolved with the user information.
	 */
	getUserById(userId) {
		return this.sendRequest(
			'/users/:userId',
			{ userId }
		);
	}

	/**
	 * Searches for a user by username or email address.
	 * @param {String} search Search term.
	 * @returns {Promise} A promise that will be resolved with a list of matching users.
	 */
	searchUsers(search) {
		// The provided search terms should not be returning more than 100 users.
		return this.sendRequest(
			'/users',
			/* eslint-disable camelcase */ // Required property naming.
			{
				per_page: 100,
				search
			}
			/* eslint-enable camelcase */
		);
	}

	/**
	 * Gets a project by ID.
	 * @param {String|Number} projectId The project ID.
	 * @returns {Promise<Object>} A promise that will be resolved with the project information.
	 */
	getProject(projectId) {
		return this.sendRequest(
			'/projects/:projectId',
			{ projectId }
		);
	}

	/**
	 * Gets a page of open issues for a project.
	 * @param {String|Number} projectId The project ID.
	 * @param {Number} [page] The page to get.
	 * @returns {Promise.<{data: *, page: Number, totalPages: Number}>} A promise that will be resolved with a page of open issues.
	 */
	getOpenIssues(projectId, page) {
		return this.sendPaginatedRequest(
			'/projects/:projectId/issues',
			{
				projectId,
				state: 'opened'
			},
			page
		);
	}

	/**
	 * Gets the labels for a project.
	 * @param {Number} projectId The project ID.
	 * @returns {Promise} A promise that will be resolved with project labels.
	 */
	getLabels(projectId) {
		// Technically the labels API is paginated, but who has more than 100 labels?
		return this.sendRequest(
			'/projects/:projectId/labels',
			/* eslint-disable camelcase */ // Required property naming.
			{
				per_page: 100,
				projectId
			}
			/* eslint-enable camelcase */
		);
	}

	/**
	 * Gets a milestone.
	 * @param {Number} projectId The project ID.
	 * @param {Number} milestoneId The milestone ID.
	 * @returns {Promise} A promise that will be resolved with the milestone.
	 */
	getMilestone(projectId, milestoneId) {
		return this.sendRequest(
			'/projects/:projectId/milestones/:milestoneId',
			{ projectId, milestoneId }
		);
	}

	/**
	 * Sends a request to a paginated resource.
	 * @param {String} route The route.
	 * @param {Object} [params] A map of parameters.
	 * @param {Number} [page] The page to get. (default = `1`)
	 * @returns {Promise<{ data: *, page: Number, totalPages: Number }>} A promise that will be resolved with the paginated result.
	 */
	async sendPaginatedRequest(route, params = {}, page = 1) {
		/* eslint-disable camelcase */ // Required property naming.
		params.per_page = 100;
		params.page = page;
		/* eslint-enable camelcase */

		const response = await this.sendRequest(route, params, true);

		return {
			data: response.body,
			page: parseInt(response.headers['x-page'], 10),
			totalPages: parseInt(response.headers['x-total-pages'], 10)
		};
	}

	/**
	 * Sends a request to the GitLab API.
	 * @param {String} route The route.
	 * @param {Object} [params] A map of parameters.
	 * @param {Boolean} [full] Indicates whether the full response should be returned.
	 * @returns {Promise<*>} A promise that will be resolved with the API result.
	 */
	async sendRequest(route, params, full) {
		if (!route) {
			throw new Error('GitLabApi sendRequest - route is required.');
		}

		if (!params) {
			params = {};
		}

		// We drain any route parameters out of params first; the rest are query string parameters.
		const filledRoute = route.replace(ROUTE_PARAM_PATTERN, function (match, name) {
			const value = params[name];

			if (_.isNil(value)) {
				throw new Error(`GitLabApi ${route} - Route parameter ${name} was not present in params.`);
			}

			delete params[name];

			return value.toString();
		});

		if (_.isEmpty(params)) {
			debug(chalk`{cyan SEND} -> GET {gray %s}`, filledRoute);
		} else {
			debug(chalk`{cyan SEND} -> GET {gray %s} %o`, filledRoute, !_.isEmpty(params) ? params : undefined);
		}

		try {
			const response = await rp({
				url: this._baseUrl + filledRoute,
				qs: params,
				headers: {
					Accept: 'application/json',
					'Private-Token': this._token
				},
				json: true,
				rejectUnauthorized: false,
				resolveWithFullResponse: true
			});

			debug(chalk`{cyan RECV} <- GET {gray %s} -> {green %d %s}`, filledRoute, response.statusCode, http.STATUS_CODES[response.statusCode]);

			return full ? response : response.body;
		} catch (e) {
			let output, message;

			if (!e.response) {
				message = e.message;
			} else {
				output = e.response.toJSON();
				message = output.body.error || output.body.message || output.body;
			}

			const failure = new Error(`GitLabApi ${filledRoute} - ${message}`);
			failure.statusCode = e.statusCode;

			if (output) {
				debug(chalk`{red FAIL} <- GET {gray %s} -> {red %d} {redBright %s} ! %s`, filledRoute, failure.statusCode, http.STATUS_CODES[failure.statusCode], message);
				console.log(chalk`{red FAIL} {yellow Response Body ---------------------}`, '\n', util.inspect(output, { colors: supportsColor.stdout.level > 0, depth: 5 }));
			} else {
				debug(chalk`{red FAIL} <- GET {gray %s} -> {red %s} ! %s`, filledRoute, e.name, message);
			}

			throw failure;
		}
	}
}

exports.GitLabApi = GitLabApi;
