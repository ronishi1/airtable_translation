# airtable_translation

## Services

[Airtable](https://airtable.com/) is used to store all the data and manage it in a spreadsheet format. It will be where all the information will be stored and where all the translations will be pushed to.

[Slack](https://slack.com/) is used as a notification system for the translator. Notifications of successful translations or any flagged translations will be sent to the channels in Slack.

[IBM Language Translator](https://www.ibm.com/watson/services/language-translator/) is used to provide translation services alongside Google. 

[Google Cloud Translation](https://cloud.google.com/translate) is used to provide translation services alongside IBM.

[Firebase](https://firebase.google.com/) is used to run translations automatically on a schedule (e.g. daily, weekly, etc). 

## Setting up
To setup this translation script, you will need to follow the setup guides for the following. All API keys, IDs, etc will be stored in a file called config.json. To create it, make a copy template_config.json and rename the file to config.json. In this file, you will be setting all the information needed to get this script working. See below for specifics on setting up all necessary accounts filling out the information for the config.

### Airtable
1. Create or login to your [Airtable](https://airtable.com/) account. Once you have created or logged into your account, go to this [template](https://airtable.com/shr2JS2gOlATdwKeD) and click on the **Copy base** button on the top right to create a copy of the template.

1. Generate or get your API key from [here](https://airtable.com/account) and put it in the section designated in the config.json. It will look like this.
    ```
    "apiKeyAirtable":"Paste your Airtable API key here"
    ```
1. Visit [here](https://airtable.com/api) and click on the copy of the template you have created. In the **Introduction** section, you can find the baseID highlighted in green where it says "The ID of this base is". Paste it as seen below into config.json.
    ```
    "baseURL":"Paste your base ID here"
    ```
1. For every table that you need to translate, you will need to setup the config as follows. This example is based on the [translation template](https://airtable.com/shr2JS2gOlATdwKeD). 

* **languages** is a list of languages that you want to translate to, each language must be surrounded by quotation marks and separated by a comma.

* **fieldsToTranslate** is a list of fields that you want to translate, each field must be surrounded by quotation marks and separated by a comma. 

* **lastUpdatedName** is the name of the column that keeps track of when the record was last updated. 

* **tableID** is the ID of the table that you are trying to translate. You can find this tableID in the URL once you click on the table in the format https://airtable.com/tbl12345/viw12345 where the tableID would be tbl12345.

* **viewID** is the ID of the view for the table that you are trying to translate. You can find this viewID in the URL once you click on the table in the format
https://airtable.com/tbl12345/viw12345 where the viewID would be viw12345.

* **name** is the name of the table.

* **FPCmaxTranslateLength** is the maximum number of characters that the script will translate for one record, if it's too long it will be flagged and notified on slack.

* **maxRecords** is the maximum number of records that will be translated when the script is ran. 
```
"tables":[
  {
    "languages":["Spanish","Chinese"],
    "fieldsToTranslate":["[Field to Translate 1]"],
    "lastUpdatedName":"[Last Updated]",
    "tableID":"Paste your tableID here",
    "viewID":"Paste your viewID here",
    "name":"Translation Table 1",
    "FPCmaxTranslateLength":350,
    "maxRecords":5
  }
]
```
### Slack
1. Create an account on [Slack](https://slack.com/). 

1. [Create a workspace](https://slack.com/help/articles/206845317-Create-a-Slack-workspace)

1. Navigate [here](https://api.slack.com/apps) and create a new app by selecting the workspace you made earlier.

1. On the sidebar under **Features**, click on **OAuth and Permissions**.

1. Add the bot token scopes **chat:write** and **chat:write:public** under the section **Scopes**. 

1. On the same page under the section **OAuth Tokens & Redirect URLs**, generate a bot user OAuth token and paste it into config.json as seen below.
    ```
    "slackAuth":"Paste your bot user OAuth token here"
    ```
1. Navigate back to your Slack workspace and [create a channel](https://slack.com/help/articles/201402297-Create-a-channel) for server logs. Click on the channel and the URL will be formatted as https://app.slack.com/client/T012345/C012345. In this case the channel ID will be C012345. Paste this channelID into the section of config.json as seen below.
    ```
    "successChannelID":"Paste the channel ID for logs here"
    ```
1. Create another channel for error logs and do the same as above but paste it into the errorChannelID
    ```
    "errorChannelID":"Paste the channel ID for errors here"
    ```

### IBM Translation
1. Create or login to your [IBM Cloud](https://www.ibm.com/cloud) account. 

1. Go to the [language translator](https://cloud.ibm.com/catalog/services/language-translator) page. Select the location closest to you and the Lite pricing plan, then press create. 

1. Navigate to [resources](https://cloud.ibm.com/resources) and click on **Languages Translator** under **Services**. 

1. Find the **API key** and **service URL** and paste into the section of config.json as seen below
    ```
    "apiKeyIBM":"Put in API key for IBM here",
    "IBMserviceURL":Put in the service URL for IBM here"
    ```

### Google Translation
For setting up google cloud translation, in this [guide](https://cloud.google.com/translate/docs/setup) follow the steps in the sections 
* **Create or select a project**
* **Enable Billing**
* **Enabling the API**
* **Create service accounts and keys** 

After completing the section **Create service accounts and keys**, go to the section **Creating service account keys** in this other [guide](https://cloud.google.com/iam/docs/creating-managing-service-account-keys). Follow steps 3-6 and make sure on Step 6 to choose the type as **JSON**. 

Once you download the JSON after step 6, create a copy of it and store it somewhere safe as **you will not be able to download it again**. Then rename the JSON to **google-services.json**. 

Move the JSON into the folder of this project, you do not need to modify config for this step. 

### Firebase Functions
WIP

## Running the script

### Running using Firebase Functions

## Costs
The two services that may incur costs are the translation services. This script uses Google and IBM's cloud translation which each have a monthly limit on the number of characters translated. For google, this capacity is **500,000 characters per month**, and for IBM the capacity is **1,000,000 characters per month**. As of now, the script will first run Google's translation service until config["googleMonthlyCutOff"] * 500,000 characters has been surpassed, at which point it will switch over to IBM. This is done in order to maximize the number of free translations that are possible. 

[Google Pricing](https://cloud.google.com/translate/pricing)

[IBM Pricing](https://www.ibm.com/watson/services/language-translator/)

## Advanced User Guide
### Running manually
To run the script manually you will need to install node which you can do [here](https://nodejs.org/en/download/)

After installing node, you will need to create a new file (e.g. translator.ts) in this project directory and paste the following code into it.
```
const Translator = require("./update_translations.ts")
const config = require("./config.json");
let t = new Translator(config);
t.executeTranslation();
```

Navigate to this directory in the terminal and run 
```
npm install
```
in order to install all the dependencies necessary to run this script.

Once that is finished, simply type
```
node translator.ts
```
in order to run the script manually. 
