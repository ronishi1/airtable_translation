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
https://slack.com/help/articles/115005265703-Create-a-bot-for-your-workspace#add-a-bot-user

### IBM Translation
Create or login to your [IBM Cloud](https://www.ibm.com/cloud) account. 

### Google Translation
https://cloud.google.com/translate/docs/setup

### Firebase Functions

## pricing section

