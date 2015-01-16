**gitlab-slack** is a service that receives outgoing webhook notifications from GitLab and posts information to an incoming webhook on Slack.
# Information
**gitlab-slack** processes GitLab webhook messages for **commits**, **issues** and **tags**. **issue** messages
with an `action` of `open` are ignored.

Status and error messages are logged to `gitlab-slack.log` in the application directory.

### Configuration Syntax
**gitlab-slack** is configured by values in the `config.json` file. This file is expected to be in the application
directory. The configuration file has the following keys:

* `slack_webhook_uri` - The URI of the Slack incoming webhook.
* `gitlab_api_token` - The GitLab API token to use for GitLab API requests.
* `port` - The port on which to listen.
* `project_channel_map` - An object containing mapping from GitLab project ID to Slack channel name. The channel name
						  must be preceded by an octothorpe (#).

Additional keys can be added for documentation purposes, but they will be ignored by the application.

# Installation
> _**nodejs** and **npm** are prerequisites to the installation of this application._

1. `cd /opt`
1. `git clone ***REMOVED*** gitlab-slack`    
    Clone the **gitlab-slack** repository into the `/opt` directory.
1. `cd gitlab-slack`
1. `npm install`    
    Install the **nodejs** dependencies.
1. `cp scripts/init.d/gitlab-slack /etc/init.d`    
   Copy the service script to the `/etc/init.d` directory.
1. `chmod 755 /etc/init.d/gitlab-slack`    
   Allow the service script to run.
1. `update-rc.d gitlab-slack start 70 2 3 4 5 . stop 40 0 1 6 .`    
   On Ubuntu, set the start and stop priorities for the service script.
1. `service gitlab-slack start`