"use strict";

var http = require("http"),
	util = require("util"),
	request = require("request"),
	Q = require("q"),
	log4js = require("log4js");

var SLACK_WEBHOOK_URI = "***REMOVED***",
	GITLAB_TOKEN = "***REMOVED***";

var projectChannelMap = {
	12: "#maas"
};

log4js.configure({
	appenders: [
		{ type: "console" },
		{ type: "file", filename: "gitlab-slack.log" }
	]
});
var logger = log4js.getLogger();

var server = http.createServer(function(request, response) {
	if (request.method == "POST") {
		var buffers = [];

		request.on("data", function(data) {
			buffers.push(data);
		});

		request.on("end", function() {
			var data;

			try {
				data = JSON.parse(Buffer.concat(buffers).toString());
			} catch (e) {
				logger.error(e);
				response.end();
			}

			if (data) {
				parseNotification(data)
					.catch(function(error) {
						logger.error(error);
					})
					.finally(function() {
						response.end();
					});
			}
		});

	} else {
		response.statusCode = 405;
		response.end(http.STATUS_CODES[405]);
	}
});

logger.info("gitlab-slack listening for webhooks");

server.listen(21012);

// ============================================================================================

/**
 * Parses the raw notification data from the GitLab webhook.
 * @param {Object} data The raw notification data.
 * @returns {Q.Promise} A promise that will be resolved when the data is processed.
 */
function parseNotification(data) {
	var gitlab = new GitLab(GITLAB_TOKEN),
		processed;

	if (data.object_kind) {
		switch (data.object_kind) {
			case "issue":
				processed = processIssue(gitlab, data.object_attributes);
				break;
		}
	} else if (data.commits) {
		processed = processCommit(gitlab, data)
	}

	if (!processed) {
		processed = processUnrecognized(data);
	}

	return processed.then(function(response) {
		var deferred = Q.defer();

		request(
			{
				method: "POST",
				uri: SLACK_WEBHOOK_URI,
				json: true,
				body: response
			},
			function (error, response, body) {
				processResponse(error, response, body)
					.then(function(response) {
						deferred.resolve(response);
					})
					.catch(function(error) {
						deferred.reject(error);
					});
			}
		);

		return deferred.promise;
	});
}

/**
 * Processes an issue message.
 * @param {GitLab} gitlab An instance of the GitLab API wrapper.
 * @param {Object} issueData The issue message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processIssue(gitlab, issueData) {
	return Q.spread(
		[gitlab.getProject(issueData.project_id), gitlab.getUserById(issueData.author_id)],
		function(project, user) {
			var channel = projectChannelMap[project.id],
				verb;

			switch (issueData.action) {
				case "open":
					verb = "created";
					break;
				case "update":
					verb = "modified";
					break;
				case "close":
					verb = "closed";
					break;
				default:
					verb = "(" + issueData.action + ")";
					break;
			}

			var response = {
				parse: "none",
				text: util.format(
					"[%s] Issue %s by <https://***REMOVED***/u/%s|%s>:",
					project.path,
					verb,
					user.username,
					user.username
				),
				attachments: [
					{
						fallback: util.format(
							"#%s %s\r\n%s",
							issueData.iid,
							issueData.title,
							issueData.description
						),
						title: util.format(
							"<%s|#%s %s>",
							issueData.url,
							issueData.iid,
							issueData.title
						),
						text: issueData.description,
						color: "#F28A2B",
						mrkdwn_in: ["title", "text"]
					}
				]
			};

			if (channel) {
				response.channel = channel;
			}

			return response;
		}
	)
}

/**
 * Processes a commit message.
 * @param {GitLab} gitlab       An instance of the GitLab API wrapper.
 * @param {Object} commitData   The commit message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processCommit(gitlab, commitData) {
	// Resolve the project ID and user ID to get more info.
	var calls = [gitlab.getProject(commitData.project_id), gitlab.getUserById(commitData.user_id)];

	// Also resolve each commit's user by email address.
	commitData.commits.forEach(function(c) {
		calls.push(gitlab.searchUserByEmail(c.author.email));
	});

	return Q.spread(calls, function(project, user) {
		var channel = projectChannelMap[project.id],
			attachment = {
				color: "#317CB9",
				mrkdwn_in: ["text"]
			},
			response = {
				parse: "none",
				text: util.format(
					"[%s:%s] %s new commits by <https://***REMOVED***/u/%s|%s>:",
					project.path,
					commitData.ref.substr(commitData.ref.lastIndexOf("/") + 1),
					commitData.total_commits_count,
					user.username,
					user.username
				),
				attachments: [attachment]
			},
			attachmentFallbacks = [],
			attachmentTexts = [];

		for (var i = 0; i < commitData.commits.length; i++) {
			var commit = commitData.commits[i],
				commitUser = arguments[i + 2][0], // all parameters after the static ones are commit users
				commitId = commit.id.substr(0, 8),
				message = commit.message.split(/(?:\r\n|[\r\n])/)[0];

			attachmentFallbacks.push(util.format(
				"[%s] %s: %s",
				commitUser.username,
				commitId,
				message
			));

			attachmentTexts.push(util.format(
				"[%s] <%s|%s>: %s",
				commitUser.username,
				commit.url,
				commitId,
				message
			));
		}

		attachment.fallback = attachmentFallbacks.join("\r\n");
		attachment.text = attachmentTexts.join("\r\n");

		if (channel) {
			response.channel = channel;
		}

		return response;
	});
}

/**
 * Processes an unrecognized message.
 * @param {Object} data The unrecognized data.
 * @returns {Q.Promise} A promise resolved with the unrecognized data.
 */
function processUnrecognized(data) {
	// Post anything unrecognized raw to a DM.
	var dataString = JSON.stringify(data, null, 4),
		response = {
			parse: "none",
			channel: "@harwood",
			attachments: [{
				title: "GitLab Webhook - Unrecognized Data",
				fallback: dataString,
				text: "```" + dataString + "```",
				color: "danger",
				mrkdwn_in: ["text"]
			}]
		};

	return Q(response);
}

/**
 * Processes the response from a request.
 * @param {*} error                     The error.
 * @param {IncomingMessage} response    The response.
 * @param {String|Object} body          The response body.
 * @returns {Q.Promise} A promise resolved or rejected depending on the properties of the response.
 */
function processResponse(error, response, body) {
	var deferred = Q.defer();

	if (error) {
		deferred.reject(error);
	} else if (response.statusCode < 200 || response.statusCode > 299) {
		if (response.headers["content-length"] <= 250) {
			if (typeof(body) !== "string") {
				body = JSON.stringify(body);
			}

			deferred.reject(response.statusCode + ": " + body);
		} else {
			deferred.reject(response.statusCode + ": " + http.STATUS_CODES[response.statusCode]);
		}
	} else {
		deferred.resolve(body);
	}

	return deferred.promise;
}

/**
 * Wrapper for the GitLab API.
 * @param {String} token GitLab token.
 * @constructor
 */
function GitLab(token) {
	var BASE_URI = "https://***REMOVED***/api/v3";

	/**
	 * Gets user information by ID.
	 * @param {String|Number} id The user ID.
	 * @returns {Promise} A promise that will be resolved with the user information.
	 */
	this.getUserById = function(id) {
		return sendRequest(BASE_URI + "/users/:id".replace(":id", id));
	};

	/**
	 * Searches for a user by email address.
	 * @param {String} email User email address.
	 * @returns {Promise} A promise that will be resolved with a list of matching users.
	 */
	this.searchUserByEmail = function(email) {
		return sendRequest(BASE_URI + "/users?search=" + email);
	};

	/**
	 * Gets project information by ID.
	 * @param {String|Number} id The project ID.
	 * @returns {Promise} A promise that will be resolved with the project information.
	 */
	this.getProject = function(id) {
		return sendRequest(BASE_URI + "/projects/:id".replace(":id", id));
	};

	/**
	 * Sends a request to the GitLab API.
	 * @param {String} uri The URI.
	 * @param {String} [method] The HTTP method. Default = GET
	 * @returns {Promise} A promise that will be resolved with the response body.
	 */
	function sendRequest(uri, method) {
		var deferred = Q.defer();

		if (!method) {
			method = "GET";
		}

		request(
			{
				method: method,
				uri: uri,
				headers: {
					"PRIVATE-TOKEN": token
				},
				json: true,
				rejectUnauthorized: false
			},
			function (error, response, body) {
				processResponse(error, response, body)
					.then(function(response) {
						deferred.resolve(response);
					})
					.catch(function(error) {
						deferred.reject(error);
					});
			}
		);

		return deferred.promise;
	}
}