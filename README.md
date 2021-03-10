# airtable_translation

## Setting up
To setup this translation script, you will need to follow the setup guides for the following. All API keys, IDs, etc will be stored in a file called config.json. To create it, make a copy template_config.json and rename the file to config.json. In this file, you will be setting all the information needed to get this script working. See below for specifics on setting up all necessary accounts filling out the information for the config.

### Airtable
Create or login to your [Airtable](https://airtable.com/) account. Once you have created or logged into your account, go to this [template](https://airtable.com/shr2JS2gOlATdwKeD) and click on the copy base button on the top right to create a copy of the template.

Afterwards, generate or get your API key from [here](https://airtable.com/account) and put it in the section designated in the config.json. It will look like this.
```
"apiKeyAirtable":"Paste your Airtable API key here"
```
In addition, visit [here](https://airtable.com/api) and click on the copy of the template you have created. The URL on the API page will be in the format of airtable.com/baseID/api/docs, please copy only the baseID into the relevant section in config.json as seen below.
```
"baseURL":"Paste your base ID here"
```

### Slack
Create an account and workspace on [Slack](https://slack.com/). 

After you have created a workspace, navigate [here](https://api.slack.com/apps) and either select your existing app or create a new app with the workspace made earlier.

On the sidebar under features, click on OAuth and Permissions.

Add the bot token scopes chat:write and chat:write:public under the section Scopes. 

Under the section OAuth Tokens & Redirect URLs, generate the Bot User OAuth Token and paste it into config.json as seen below.

```
"slackAuth":"Paste your bot user OAuth token here"
```
Navigate back to your Slack workspace and create a channel for server logs. Click on the channel and copy the channelID part from the URL https://app.slack.com/client/teamID/channelID. It will start with a C. Paste this channelID into the section of config.json as seen below.
```
"successChannelID":"Paste the channel ID for logs here"
```
Create another channel for error logs and do the same as above but paste it into the errorChannelID
```
"errorChannelID":"CHANNEL ID FOR ERRORS HERE"
```

### IBM Translation
Create or login to your [IBM Cloud](https://www.ibm.com/cloud) account. 

### Google Translation
https://cloud.google.com/translate/docs/setup

### Firebase Functions

## Running the script

### Running using Firebase Functions

### Running manually

## Costs
The two services that may incur costs are the translation services. This script uses Google and IBM's cloud translation which each have a monthly limit on the number of characters translated. For google, this capacity is **500,000 characters per month**, and for IBM the capacity is **1,000,000 characters per month**. As of now, the script will first run Google's translation service until config["googleMonthlyCutOff"] * 500,000 characters has been surpassed, at which point it will switch over to IBM. This is done in order to maximize the number of free translations that are possible. 

[Google Pricing](https://cloud.google.com/translate/pricing)

[IBM Pricing](https://www.ibm.com/watson/services/language-translator/)

