A service that receives hook notifications from GitLab and posts information to an incoming webhook on Slack.

## Information
**gitlab-slack** processes GitLab webhook messages for **commits**, **issues** and **tags**. **issue** messages
with an `action` of `open` are ignored.

Status and error messages are logged to **gitlab-slack.log** in the application directory.

### Configuration
**gitlab-slack** is configured by values in the **config.json** file. This file is expected to be in the application
directory. The configuration file has the following keys:

* `slack_webhook_uri` - The URI of the Slack incoming webhook.
* `gitlab_api_token` - The GitLab API token to use for GitLab API requests.
* `port` - The port on which to listen.
* `project_channel_map` - A mapping from GitLab project ID to Slack channel name. The channel name must be preceded
                           by an octothorpe (#).

Additional keys can be added for documentation purposes, but they will be ignored by the application.

## Installation
