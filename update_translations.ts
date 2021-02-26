const { WebClient, LogLevel } = require("@slack/web-api");
const {Translate} = require('@google-cloud/translate').v2;
const LanguageTranslatorV3 = require('ibm-watson/language-translator/v3');
const { IamAuthenticator } = require('ibm-watson/auth');
const  Airtable = require('airtable');
class Translator{

  // guide for moving to firebase functions
  // inside functions folder for firebase
  // FUTURE TODO
  // * ADD INTO CONFIG THE NAME OF THE LOOKUP FOR TRANSLATION
  // * DOCUMENTATION: LIST NEEDED ACCOUNTS => (ibm accounts, google translate accounts, airtable, firebase, slack)
  // * put url to all things listed above + instructions on what needs to be enabled
  // * estimate of cost (based on num of translations)
  // * config file explained => each item is concisely explained
  // * how to setup airtable (need fields like last updated, translation sources etc)
  // * include topdown explanation of how script works (e.g. last updated compared to last updated spanish)
  // * manual overrides explained
  // * all formatting issues that were dealt with (quotations, markdown urls, markdown bullet points) (could be more issues)

  // consider open sourcing after this

  // For logs, slack can likely keep track of about at least a years worth of logs
  // Slack holds 10000 messages at a time (all channels combined)

  // version in generating IBM translation may need to be updated (read below)
  // https://cloud.ibm.com/apidocs/language-translator?code=node#versioning

  // IBM service url location link
  // https://cloud.ibm.com/apidocs/language-translator?code=node#endpoint-cloud

  constructor(config){
    this.config = config;
    this.languageTranslator = new LanguageTranslatorV3({
      version: '2021-02-06',
      authenticator: new IamAuthenticator({
        apikey: config["apiKeyIBM"],
      }),
      serviceUrl: config["IBMserviceURL"],
    });
    this.base = new Airtable({apiKey: config["apiKeyAirtable"]}).base(config["baseURL"]);
    process.env.GOOGLE_APPLICATION_CREDENTIALS=config["pathToGoogleFile"];
    this.translate = new Translate();
    this.update_chunk_size = 10;
    // IBM DOES NOT SUPPORT TRANSLATION INTO HAITIAN CREOLE
    // Add more languages to support later on
    this.langObj = {
      Spanish: 'es',
      Chinese: 'zh',
      'Haitian Creole':'ht',
      Portuguese: 'pt',
    }
    this.unsupportedIBM = ['Haitian Creole']
    this.client = new WebClient(this.config["slackAuth"]);
  }

  update_translations(language,table,countID){
    let translateArr = [];
    let flagRecordArr = [];
    let flagStr = "";
    let filterStr = "OR(";
    table["fieldsToTranslate"].forEach(field => {
      filterStr += "AND(NOT({" + field + "} = BLANK()),NOT(trim({" + field + "}) = \"\")),";
    });
    filterStr = filterStr.substring(0,filterStr.length-1);
    filterStr += ")"
    return new Promise((resolve, reject) => {
      this.base(table["tableID"]).select({
        maxRecords: table["maxRecords"],
        pageSize:100,
        // ARRAYJOIN is used to convert the lookup column into a string so that we can search
        // airtable has some difference between a list and lookup lists that prevents search from working properly
        filterByFormula: `and(search(\"${language}\",
        ARRAYJOIN({languages})) > 0,
        or({Last Updated ${language}} = BLANK(),datetime_diff({${table["lastUpdatedName"]}},{Last Updated ${language}},\'s\') > 0),${filterStr})`
      }).eachPage(function page(records, fetchNextPage) {
        records.forEach(function(record) {
          table["fieldsToTranslate"].forEach(async (field) => {
            const text = typeof record.get(field) == 'undefined' ? "" : record.get(field).trim()
            if(text != ""){
              if(text.length < table["FPCmaxTranslateLength"]){
                translateArr.push({
                  "id":record["id"],
                  "field":field,
                  "text":text
                })
              }

              else {
                // assuming that all tables will have an id field
                if(record.get(this.config["overrideName"])){
                  translateArr.push({
                    "id":record["id"],
                    "field":field,
                    "text":text
                  });
                }
                else {
                  try {
                    const result = await this.client.chat.postMessage({
                      channel: this.config["errorChannelID"],
                      text: `Automatic Translations \n${table["name"]}\n${language} ${text.length}/${table["FPCmaxTranslateLength"]} https://airtable.com/${table["tableID"]}/${table["viewID"]}/${record["id"]}`,
                    });
                  }
                  // Better error handling/reporting
                  catch (error) {
                    console.error(error);
                  }
                }
              }
            }
          })

        });

        fetchNextPage();

      }, async (err)=> {
        const monthNames = ["January", "February", "March", "April", "May", "June","July", "August", "September", "October", "November", "December"];
        let date = new Date();
        const formattedDate = date.getFullYear() + " " + monthNames[date.getMonth()];
        let sumGoogle = 0;
        let sumIBM = 0;
        this.base(this.config["countTableID"]).select({
          filterByFormula:`{month}=\"${formattedDate}\"`
        }).eachPage(function page(records, fetchNextPage) {

          records.forEach(function(record) {
            if(record.get("translation source") == "IBM"){
              sumIBM += record.get("number of characters translated");
            }
            else {
              sumGoogle += record.get("number of characters translated");
            }
          });

          fetchNextPage();

        }, async (err) => {
          // googleMonthlyCutoff is the percentage of google's maximum character limit to translate to
          if(sumGoogle > 500000 * this.config["googleMonthlyCutoff"] && !(this.unsupportedIBM.includes(language))){
            await this.translate_text_ibm(translateArr,language,table["tableID"],table["name"],countID)
          }
          else {
            await this.translate_text_google(translateArr,language,table["tableID"],table["name"],countID)
          }
          if (err) { console.error(err); return; }
        });
        resolve();
        if (err) { console.error(err); return; }
      });
    })
  }

  // IBM WATSON TRANSLATION CHAR LIMIT IS ABOUT 12800 CHARACTERS
  // Input text in UTF-8 encoding. Submit a maximum of 50 KB (51,200 bytes) of text with a single request. Multiple elements result in multiple translations in the response
  async translate_text_ibm(translateArr,language,table,name,countID){
    if (translateArr.length == 0){
      console.error("ERROR: translate array is empty");
      const result = await this.client.chat.postMessage({
        channel: this.config["successChannelID"],
        text: `Automatic Translations \n ${name}\n ${language}\n Total Records Translated 0 \n Total Characters Translated 0`,
      });
      return;
    }
    let text = [];
    let charCount = 0;
    let temp = [];
    let numCharsTranslated = 0;
    let numRecordsTranslated = 0;
    translateArr.forEach(element => {
      if((charCount + element["text"].length) > this.config["googleTranslateCharLimit"]){
        text.push(temp);
        charCount = 0;
        temp = []
      }
      numRecordsTranslated++;
      charCount += element["text"].length;
      numCharsTranslated += element["text"].length;
      temp.push(element["text"]);
    });
    try {
      // Call the chat.postMessage method using the WebClient
      const result = await this.client.chat.postMessage({
        channel: this.config["successChannelID"],
        text: `Automatic Translations \n ${name}\n ${language}\nIBM \nTotal Records Translated ${numRecordsTranslated} \n Total Characters Translated ${numCharsTranslated}`,
      });
      const date = new Date();
      let countObj = {
        name:name,
        date:new Date(),
        "number of characters translated":numCharsTranslated,
        "language":language,
        "number of records":numRecordsTranslated,
      }
      countObj["translation source"] = "IBM";
      this.base(countID).create(countObj, function(err, records) {
        if (err) {
          console.error(err);
          return;
        };
      });
    }
    catch (error) {
      console.error(error);
    }
    text.push(temp);
    const target = this.langObj[language];
    let resultArr = [];
    for(var i = 0;i<text.length;i++){
      let arr = text[i];

      const translateParams = {
        text: arr,
        source:'en',
        target:target
      };

      await this.languageTranslator.translate(translateParams)
      .then(translationResult => {
        translationResult.result.translations.forEach(translation => {
          translation = this.fixFormatting(translation.translation);
          resultArr.push(translation);
        });
      })
      .catch(err => {
        console.error('error:', err);
      });


    };
    this.build_update(translateArr,resultArr,language,table);
  }

  async translate_text_google(translateArr,language,table,name,countID){
    if (translateArr.length == 0){
      console.error("ERROR: translate array is empty");
      const result = await this.client.chat.postMessage({
        channel: this.config["successChannelID"],
        text: `Automatic Translations \n ${name}\n ${language}\nTotal Records Translated 0 \n Total Characters Translated 0`,
      });
      return;
    }
    let text = [];
    let charCount = 0;
    let temp = [];
    let numCharsTranslated = 0;
    let numRecordsTranslated = 0;
    translateArr.forEach(element => {
      if((charCount + element["text"].length) > this.config["googleTranslateCharLimit"]){
        text.push(temp);
        charCount = 0;
        temp = []
      }
      numRecordsTranslated++;
      charCount += element["text"].length;
      numCharsTranslated += element["text"].length;
      temp.push(element["text"]);
    });
    try {
      // Call the chat.postMessage method using the WebClient
      const result = await this.client.chat.postMessage({
        channel: this.config["successChannelID"],
        text: `Automatic Translations \n ${name}\n ${language}\nGoogle \nTotal Records Translated ${numRecordsTranslated} \n Total Characters Translated ${numCharsTranslated}`,
      });
      const date = new Date();
      let countObj = {
        name:name,
        date:new Date(),
        "number of characters translated":numCharsTranslated,
        "language":language,
        "number of records":numRecordsTranslated,
      }
      countObj["translation source"] = "Google";
      this.base(countID).create(countObj, function(err, records) {
        if (err) {
          console.error(err);
          return;
        };
      });
    }
    catch (error) {
      console.error(error);
    }
    text.push(temp);
    const target = this.langObj[language];
    let resultArr = [];
    for(var i = 0;i<text.length;i++){
      let arr = text[i];
      let [translations] = await this.translate.translate(arr, target);
      translations = Array.isArray(translations) ? translations : [translations];

      translations.forEach(translation => {

        translation = this.fixFormatting(translation);
        resultArr.push(translation);
      });

    };
    this.build_update(translateArr,resultArr,language,table);
  }

  fixFormatting(translation){
    // In order to bullet point in airtable, formatting needs to be "- " with the space
    // Some entries lose the space on translation so this replaces first instance
    if(translation.substring(0,2) != "- "){
      translation = "- " + translation.substring(1)
    }
    // Replaces any further instances where "- " formatting is not followed
    translation = translation.replace(/\n-(\S)/g,'\n- $1')
    translation = translation.replace(/[「」]/g,"\"")
    translation = translation.replace(/[“”]/g,"\"")
    // Gets rid of spaces for url formatting between [Website] (www.website.com) into [Website](www.website.com) for markdown formatting
    const markdownURLRegex = /\[([\w\s\d]+)\]\s?\((https?:\/\/[^\)]*)\)/g;
    let match = markdownURLRegex.exec(translation);
    let newMD = ''
    while (match != null) {
      // match[1] is the content within square brackets
      // match[2] is the url
      // newMD is the new markdown with the space between ] and ( stripped and the url stripped of any excess spaces
      newMD = "[" + match[1] + "](" + match[2].replace(/\s/g, '') + ")";
      translation = translation.replace(match[0],newMD);
      match = markdownURLRegex.exec(translation);
    }
    return translation;
  }

  build_update(translateArr,resultArr,language,table){
    let finalUpdateObj = {};
    let updateObj = {}
    for(var i = 0;i<resultArr.length;i++){
      if(!finalUpdateObj[translateArr[i]["id"]]){
        updateObj = {};
        updateObj["id"] = translateArr[i]["id"];
        updateObj["fields"] = {};
        updateObj["fields"][translateArr[i]["field"] + " " + language] = resultArr[i];
        updateObj["fields"]["Last Updated " + language] = new Date();
        updateObj["fields"][this.config["overrideName"]] = false;
        finalUpdateObj[translateArr[i]["id"]] = updateObj;
      }
      else {
        finalUpdateObj[translateArr[i]["id"]]["fields"][translateArr[i]["field"] + " " + language] = resultArr[i];
      }
    }

    this.update_airtable(Object.values(finalUpdateObj),table);
  }

  update_airtable(updateArr,table){
    let allChunks = [];
    let temp = [];
    for (let i=0;i<updateArr.length;i+= this.update_chunk_size) {
      temp= updateArr.slice(i,i+ this.update_chunk_size);
      allChunks.push(temp);
    }

    allChunks.forEach((chunk) => {
      this.base(table).update(chunk, function(err, records) {
        if (err) {
          console.error(err);
          return;
        };
      });
    })
    // console.log("done " + table);
  }

  executeTranslation(){
    this.config["tables"].forEach(table => {
      table["languages"].forEach(language => {
        this.update_translations(language,table,this.config["countTableID"]);
      });
    });
  }
}
module.exports = Translator;
