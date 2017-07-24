**gitlab-slack** is a service that receives outgoing webhook notifications from GitLab and posts information to an incoming webhook on Slack.
# Information

### Features
* Processes GitLab webhook messages for **commits**, **branches**, **tags**, **issues**, **merge requests** and **wiki pages**. ([more info](#attractive-and-functional-notifications))
* Provides translation from Markdown to Slack's formatting syntax for the formatting features that Slack supports. ([more info](#markdown-to-slack-formatting-translation))
* Issues mentioned anywhere in the commit message are aggregated and provided as links to the right of the commit summary line. ([more info](#issue-mention-summary))
* Changes to tracked labels on issues are notified as issue updates with a summary of label changes as attachments. ([more info](#issue-label-change-tracking))
* Status and error messages are logged to `stderr`; if the terminal supports colors, they are output for improved readability. ([more info](#configuring-logging))

#### Limitations
* **GitLab API Token**   
  The GitLab API token must have administrative privileges to be able to search for users by email address. This is used to translate the commit author email address into a username.
* **GitLab and GitLab API Version**   
  The GitLab API interactions were written for **v4** of their API against GitLab version **9.3**. Older or newer versions _may_ work, but are unsupported.
* **Node.js and NPM Version**   
  The code is written targeting Node.js **6.x LTS** and NPM **5.x**. Older or newer versions _may_ work, but are unsupported.

### Configuration Syntax
**gitlab-slack** is configured by values in the `config.js` file in the application directory. This file is ingested as a Node.js module and has the following structure:

```js
module.exports = {
	port: 4646,
	slackWebhookUrl: '',
	gitLab: {
		baseUrl: '',
		apiToken: '',
		projects: [
			{
				id: 0,
				name: '',
				channel: '',
				labels: []
			}
		]
	}
};
```

* `port` - The port on which to listen. (Default = `4646`)
* `slackWebhookUrl` - The URL of the Slack incoming webhook. (Example = `'https://hooks.slack.com/services/...'`)
* `gitLab` - The GitLab configuration.
  * `baseUrl` - The protocol/host/port of the GitLab installation. (Example = `'https://gitlab.company.com'`)   
    _This is expected **NOT** to have a trailing slash._
  * `apiToken` - The API token with which to query GitLab. (Example = `'hxg1qaDqX8xVELvMefPr'`)
  * `projects` - The project configuration. This section defines which projects should be tracked.
    * `id` - The ID of the project.
    * `name` - The name of the project. This value is only used for logging; the group/name namespace is recommended. (Example = `'group/project-name'`)
    * `channel` - **Optional.** Overrides the default channel for the Slack webhook. (Example = `'#project-name'`)   
      _The `#` prefix is added if it is not present._
    * `labels` - **Optional.** An array of regular expressions or strings (that will be turned into case-insensitive regular expressions) used to select issue labels that should be tracked for changes. (Example = `[ '^Status:', /^Size:/ ]`) 

**NOTE:** If the service receives a message for a project that is not configured (or does not have a channel defined), its notifications will go to the default channel for the incoming webhook. 

# Feature Details

### Attractive and Functional Notifications
**gitlab-slack** improves upon GitLab's built-in Slack integration with attractive notification formatting that provides more detail and functionality
while cutting the fat and remaining as concise as possible.
 
#### Commits
![Commit Notification](https://user-images.githubusercontent.com/1672405/28470411-a2445fe2-6e07-11e7-82d7-371db52245a6.png)    
Commit notifications include the repository name and branch, the username of the user who pushed the commit as a link and
a list of commits included in the push. Each commit includes the username of the user who made it, the short-form commit hash
as a link, the first line of the commit message, and a summary of all issues mentioned in the commit message. ([more info](#issue-mention-summary))

#### Tags and Branches
![Tag and Branch Notifications](https://user-images.githubusercontent.com/1672405/28471919-bbd1c6de-6e0c-11e7-80b2-03f459ed928a.png)    
Tag and branch notifications include the repository name, the username of the user who pushed them as a link and the branch or
tag name as a link.

If any commits are included in the new-branch message, they are also notified. If a tag includes a message, it is included below the tag.

#### Issues
![Issue Notifications](https://user-images.githubusercontent.com/1672405/28472252-dba6bffe-6e0d-11e7-9e89-9c40980b78fe.png)    
Issue notifications include the repository name, the username of the user who performed the issue action, the username of the user to
whom the issue is assigned, the milestone to which the issue is assigned and the username of the user who created the issue.
Milestones and usernames are formatted as a link. Issue notifications include a main attachment that includes the title of the issue,
as a link and, depending on the kind of action, also the issue description. Additional attachments will be included for changes
to tracked labels. ([more info](#issue-label-tracking)

#### Merge Requests
![Merge Request Notification](https://user-images.githubusercontent.com/1672405/28478482-92f28e8c-6e26-11e7-83f1-588067aa360f.png)   
Merge request notifications include the repository name, the username of the user who performed the merge request action, the username
of the user to whom the merge request is assigned, the source branch and the target branch. Merge request notifications include an
attachment that includes the title of the merge request and, depending on the kind of action, also the first line of its description.

#### Wiki Page
![Wiki Page Notification](https://user-images.githubusercontent.com/1672405/28478720-9873109c-6e27-11e7-9648-2eaebfd62520.png)   
Wiki page notifications include the repository name, the username of the user who performed the wiki page action and the slug of
the affected wiki page as a link to that page.

### Issue Mention Summary
As commit messages are truncated to their first line for notification, any issues mentioned elsewhere in the message are
summarized as a link at the end of the notified commit message. The following two commit messages...

```text
Removed the fun file (#8)
* Fixed an issue where there was a fun file.
```

```text
Added a fun file.

* This is more description.
* Fixed an issue with not having a fun file. (#3, #6)
* Fixed another issue. (#1)
```

...produce the following notification...

![Commit Message Issue Summary](https://user-images.githubusercontent.com/1672405/28476839-7e73f48e-6e1f-11e7-87a1-ed857c95268d.png)

When the issue mention is in the first line, the original issue mention is removed to avoid duplication.

### Markdown to Slack Formatting Translation
The following Markdown structures will be translated to a Slack-formatting analogue:
* Bold
* Italic
* Links (files and images)
* Headings
* Bulleted Lists (up to two levels deep)

An issue titled **Markdown to Slack formatting is awesome** with the following following markdown in the description...   

```markdown
# Heading H1
* Something is _italic_ or *italic*.
* Something else is __bold__ or **bold**.
* Here's a link to [Google](https://google.com).

Here's an [uploaded_file.7z](https://example.com/uploaded_file.7z).

Do you like pictures?   
![rubbercheeseburger.jpg](/rubbercheeseburger.jpg)

## **Heading H2**
* A list with...
  * ...more than one level!
* Back to the base level.
```
...produces an issue notification similiar to the following...   
 
![Markdown to Slack Formatting](https://user-images.githubusercontent.com/1672405/28475174-4360c5da-6e19-11e7-9140-fa694ea2a3e6.png)

Headings are simply bolded; those that are already bolded are handled appropriately. Images are processed into simple links; they do
not include the base host/protocol/port of the GitLab instance, so that is added.

### Issue Label Change Tracking
For configured projects, label change tracking can be enabled by providing a list of regular expressions or strings (which will be
converted to case-insensitive regular expressions) defining which labels **gitlab-slack** should be interested in. When enabled,
label changes will be notified in additional attachments following the main summary attachment. Each label attachment will follow
the label's configured color and indicate whether the label was _Added_ or _Removed_.

![Issue Label Change Tracking](https://user-images.githubusercontent.com/1672405/28475492-79ba968c-6e1a-11e7-880f-0f0a3985bfe0.png)

### Configuring Logging
The [debug](https://github.com/visionmedia/debug) module is used for logging under the prefix `gitlab-slack`. The logging is split
into the following components:

| Component | Description |
|:----------|:------------|
| `app` | The main application responsible for the start-up and shut-down process. |
| `server` | The HTTP server that handles incoming webhook requests. |
| `api` | The wrapper that handles communication with the GitLab API. |
| `slack` | The wrapper that handles sending notifications to the Slack incoming webhook. |
| `handler` | A set of components that handle incoming messages of various types. Sub-components are logged as `gitlab-slack:handler:<sub>`.<br>**Sub-Components**: `commit`, `branch`, `tag`, `issue`, `mergerequest`, `wikipage` |

To turn on or off logging of components, assign the `DEBUG` environment variable. For example, to only show handler log messages, set
`DEBUG` to `gitlab-slack:handler:*`. Read the documentation for **debug** for more information.

# Installation
**nodejs** and **npm** are prerequisites to the installation of this application.

### Installing the Service

The **/scripts** directory contains some example service definitions scripts for various init flavors. Check the **README** files
in those directories for more information about each script.

### Adding the GitLab Webhook
> _The **Master** or **Owner** permission level is required to modify webhooks in GitLab._

1. From the project home, click **Settings**.
1. Click **Integrations**.
1. Enter `http://127.0.0.1:PORT` into the **URL** field if, for example, **gitlab-slack** is running on the same server as GitLab.    
   Use the value of the `port` key from the `config.js` file in place of `PORT`.
   * If **gitlab-slack** is running on another server, enter the appropriate DNS or URI.
1. Check the **Push events**, **Tag push events** **Issues events**, **Merge Request events** and **Wiki Page events** triggers. If
   desired, check the **Confidential Issues events** trigger as well.   
   _The other Trigger options are not supported and will result in an "unrecognized" message being sent to the default Slack
   channel for the webhook._
1. Depending on your configuration you may want to check or un-check **Enable SSL verification**.
1. The **Secret Token** feature is not supported.
1. Click **Add webhook**.

Once added, the webhook can be tested using the **Test** button to the right of the webhook under **Webhooks**.
