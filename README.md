**gitlab-slack** is a service that receives outgoing webhook notifications from GitLab and posts information to an incoming webhook on Slack.
# Information

### Features
* Processes GitLab webhook messages for **commits**, **branches**, **tags** and **issues**. ([more info](#attractive-and-functional-notifications))
* Provides Translation from Markdown to Slack formatting syntax for the formatting features that Slack supports. ([more info](#markdown-to-slack-formatting-translation))
* Issues mentioned anywhere in the commit message are aggregated and provided as links to the right of the commit summary line. ([more info](#issue-mention-summary))
* Status and error messages are logged to `gitlab-slack.log` in the application directory.
* Changes to tracked labels on issues are notified as issue updates with a summary of label changes as attachments. ([more info](#issue-label-change-tracking))

### Configuration Syntax
**gitlab-slack** is configured by values in the `config.json` file. This file is expected to be in the application
directory. The configuration file has the following structure:

```json
{
	"port": 0,
	"slackWebhookUrl": "",
	"gitlab": {
		"baseUrl": "",
		"api": {
			"basePath": "/api/v3",
			"token": ""
		},
		"projects": {
			"0": {
				"name": "",
				"channel": "",
				"labels": [
					""
				]
			}
		}
	}
}
```

* `port` - The port on which to listen. (Default = `21012`)
* `slackWebhookUrl` - The URL of the Slack incoming webhook. (Example = `"https://hooks.slack.com/services/..."`)
* `gitlab` - The GitLab configuration.
  * `baseUrl` - The protocol/host/port of the GitLab installation. (Example = `"https://gitlab.company.com/"`)
  * `api` - The GitLab API configuration.
    * `basePath` - The API base path. (Default = `"/api/v3"`)
    * `token` - The API token with which to query GitLab. (Example = `"hxg1qaDqX8xVELvMefPr"`)
  * `projects` - The project configuration. This section defines which projects should be tracked.
    * `id` - The ID of the project as a string. (Example = `"23"`)
      * `name` - The name of the project. This value is unused by the service; it is suggested for documentation purposes. (Example = `"group/project-name"`)
      * `channel` - The Slack channel to which notifications for this project should post. The channel name must be preceded by an octothorpe (#). (Example = `"#project-name"`)
      * `labels` - **Optional.** An array of regular expressions used to select issue labels that should be tracked for changes. (Example = `[ "^Status:" ]`) 

**NOTE:** If the service receives a message for a project that is not configured, its notifications will go to the default channel for the incoming webhook. 

# Feature Details

### Attractive and Functional Notifications
**gitlab-slack** improves upon GitLab's built-in Slack integration with attractive notification formatting that provides more detail and functionality
while cutting the fat and remaining as concise as possible.
 
#### Commits
![Commit Notification](https://cloud.githubusercontent.com/assets/1672405/10584682/67204d26-7661-11e5-8362-87074bf73a3a.png)    
Commit notifications include the repository name and branch, the username of the user who pushed the commit as a link and
a list of commits included in the push. Each commit includes the username of the user who made it, the short-form commit hash
as a link, the first line of the commit message, and a summary of all issues mentioned in the commit message. ([more info](#issue-mention-summary))

#### Tags and Branches
![Tag and Branch Notifications](https://cloud.githubusercontent.com/assets/1672405/10584769/e2e8b704-7661-11e5-971a-c09633d5b276.png)    
Tag and branch notifications include the repository name, the username of the user who pushed them as a link and the branch or
tag name as a link. All commit information for branch creation is discarded as those commits would have already been notified when they were made.

#### Issues
![Issue Notifications](https://cloud.githubusercontent.com/assets/1672405/10584895/9e8fe306-7662-11e5-918c-bf2d8452576e.png)    
Issue notifications include the repository name, the username of the user performed the issue action, the username of the user to
whom the issues is assigned and the username of the user who created the issue. Each username is formatted as a link. Issue notifications
include a main attachment that includes the title of the issue, as a link, and, depending on the kind of action, also the issue
description. Additional attachments will be included for changes to tracked labels. ([more info](#issue-label-tracking))

### Issue Mention Summary
As commit messages are truncated to their first line for notification, any issues mentioned elsewhere in the message are
summarized as a link at the end of the notified commit message. The following two commit messages...

```text
Added a fun file.

* This is more description.
* Fixed an issue with not having a fun file. (#3)
* Fixed another issue. (#1)
```

```text
Removed the fun file
* Fixed an issue where there was a fun file. (#8)
```

...produce the following notification...

![Issue Summary](https://cloud.githubusercontent.com/assets/1672405/10585116/ef2d190e-7663-11e5-9b90-0af0968811f3.png)

### Markdown to Slack Formatting Translation
The following Markdown structures will be translated to a Slack-formatting analogue:
* Bold
* Italic
* Links
* Headings
* Bulleted Lists (up to two levels deep)

An issue titled **Markdown to Slack formatting is awesome** with the following following markdown in the description...    
```markdown
# Heading H1
* Something is _italic_ or *italic*.
* Something else is __bold__ or **bold**.
* Here's a link to [Google](https://google.com).

## Heading H2
* A list with...
  * ...more than one level!
* Back to the base level.
```
...produces an issue notification similiar to the following...    
![Markdown to Slack Formatting](https://cloud.githubusercontent.com/assets/1672405/10584587/06ea78f0-7661-11e5-81ad-0abf07d15cc1.png)

### Issue Label Change Tracking
For configured projects, label change tracking can be enabled by providing a list of regular expressions defining which labels
**gitlab-slack** should be interested in. When enabled, label changes will be notified in additional attachments following the
main summary attachment. Each label attachment will follow the label's configured color and indicate whether the label was
_Added_ or _Removed_.

![Issue Label Change Tracking](https://cloud.githubusercontent.com/assets/1672405/10585795/1f8c8762-7667-11e5-8f31-0725e81d5b9c.png)

# Installation
**nodejs** and **npm** are prerequisites to the installation of this application.

### Installing the Service

1. `cd /opt`
1. `git clone <repository-url> gitlab-slack`    
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

### Adding the GitLab Webhook
> _The **Master** or **Owner** permission level is required to modify webhooks in GitLab._

1. From the project home, click **Settings**.
1. Click **Web Hooks**.
1. If **gitlab-slack** is running on the same server as GitLab, enter `http://127.0.0.1:PORT` into the **URL** field.    
   Use the value of the `port` key from the `config.json` file in place of `PORT`.
1. If **gitlab-slack** is running on another server, enter the appropriate DNS or URI.
1. Check the **Push events**, **Tag push events** and **Issues events** options. **Merge Request events** are not supported.
1. Click **Add Web Hook**.

Once added, the webhook can be tested using the **Test Hook** button.
