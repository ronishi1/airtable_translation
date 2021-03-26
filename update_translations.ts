const { WebClient, LogLevel } = require("@slack/web-api");
const {Translate} = require('@google-cloud/translate').v2;
const LanguageTranslatorV3 = require('ibm-watson/language-translator/v3');
const { IamAuthenticator } = require('ibm-watson/auth');
const  Airtable = require('airtable');
class Translator{

  // guide for moving to firebase functions
  // inside functions folder for firebase
  // FUTURE TODO
  // * ADD INTO CONFIG THE NAME OF THE LOOKUP FOR TRANSLATION (current setup okay for now, generalize maybe later)
  // * ? Change format of the column (possibly)
  // * DOCUMENTATION: LIST NEEDED ACCOUNTS => (ibm accounts, google translate accounts, airtable, firebase, slack)
  // * put url to all things listed above + instructions on what needs to be enabled
  // * estimate of cost (based on num of translations)
  // * config file explained => each item is concisely explained
  // * how to setup airtable (need fields like last updated, translation sources etc)
  // * include topdown explanation of how script works (e.g. last updated compared to last updated spanish)
  // * manual overrides explained
  // * all formatting issues that were dealt with (quotations, markdown urls, markdown bullet points) (could be more issues)

  // Airtable scheduled run scripts (possible future todo)
  // https://support.airtable.com/hc/en-us/articles/1500001756941-At-a-scheduled-time-automation-trigger#h_01EWG8FWWJVCTH4ZAGXGBZRBVQ
  // https://support.airtable.com/hc/en-us/articles/360051792333-Run-a-script-Action-

  /* idea for translating w md breakdown
    note for self:
    current translation groups up a bunch of text to translate into one arr (which is pushed into text which holds all the arrays to translate)
    e.g. ["hello world","this is text for another record"]
    and since google translates arrays in the order it was given, we put it into resultArr in same order
    issue is if we break up the translations into markdown there is no easy way to rebuild resultArr since we can't
    just break down the record into chunks the same way since no way to distinguish bits of records

    easiest solution is to only translate one record at a time instead of sending multiple records at once to translate
    but could be inefficient (not sure if doing more api calls to google is more costly/slower)

    other solution if still trying to translate multiple records at once would be to preserve the indexes
    of end of each record so that theres a way to tell when we're done translating one record to combine
    and push to result arr
    possible implementation:
    currently each index of text is holding just an array of things to translate
    e.g.
    pretend md obj is for first record
    {md:":1-2-3: :1-2-4: :1-2-5:",
      values:{
        ":1-2-3:":"first record begins",
        etc

    }}
    for second record
    {md:":2-3-4:",
      values:{
        ":2-3-4:":"new record here",
    }}
    make text into an array of objects where each obj is
    {
      locations:["rec123ABC:1-2-3:","rec123ABC:1-2-4:",":1-2-5:",":2-3-4:"]
      toTranslate:["first record begin","some stuff between","first record end","new record here"]
      indexes:[2,3] (where the indexes point to the end of each record)
      template:[":1-2-3: :1-2-4: :1-2-5:",":2-3-4:"]
    }
    can check in the translations.foreach loop by adding a variable to keep track of what index we translated
    since order is preserved when google translating
    if we reach the end index then we know to rebuild that md using relevant indexes in locations arr of text since indexes match
    push to resultarr when we do the template things so that index in resultarr matches with index in template field

    POSSIBLE OTHER solution
      change the replacement id/identifier with one that ocntains the record id, since google translate has a 128 strings limit
      doing so would let us break up records into chunks without worrying about losing track of what it belongs to
      would need to store the record id with the template for that record as well somewhere
      
  */
  // ibm
  // create an account @ https://www.ibm.com/cloud
  // https://cloud.ibm.com/apidocs/language-translator?code=node

  // slack
  // https://slack.com/help/articles/115005265703-Create-a-bot-for-your-workspace#add-a-bot-user
  // For later, incorporate hours translation into it
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
        or({${table["lastUpdatedName"]} ${language}} = BLANK(),datetime_diff({${table["lastUpdatedName"]}},{${table["lastUpdatedName"]} ${language}},\'s\') > 0),${filterStr})`
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
            await this.translate_text_ibm(translateArr,language,table,table["name"],countID)
          }
          else {
            await this.translate_text_google(translateArr,language,table,table["name"],countID)
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
      // text => [temp1, temp2]
      // temp => ["record one text","record two text"]
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
        // TODO:
        // Check if we need to generalize Last Updated + Language since we specify last updated in config
        updateObj["fields"][table["lastUpdatedName"] + " " + language] = new Date();
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
      this.base(table["tableID"]).update(chunk, function(err, records) {
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
