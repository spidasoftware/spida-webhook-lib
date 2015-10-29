var url = require('url');
var http = require('http');
var querystring = require('querystring');

module.exports = {

    enableDebugLog: false,

    /**
     * Log if extra logging.
     */
    debugLog: function(s){
        if(this.enableDebugLog){
            console.log(s);
        }
    },

    /**
     * Convert stdin to a json object and pass into the callback.
     */
    doWithStdinJson: function(callback){
        var self = this;
        var stdin = process.stdin;
        var inputChunks = [];

        stdin.resume();
        stdin.setEncoding('utf8');
        stdin.on('data', function (chunk) { 
            inputChunks.push(chunk); 
        });

        stdin.on('end', function () {
            var inputJSON = inputChunks.join("");
            var parsedStdin = JSON.parse(inputJSON);
            self.debugLog("parsedStdin: " + JSON.stringify(parsedStdin));
            callback(parsedStdin);
        });
    },

    /**
     * Finds the form in a min project.
     */
    getForm: function(stdinJsonObj, formName){
        var minProject = stdinJsonObj.payload.part;
        if(!minProject.dataForms){
            return null;
        }
        var formsFound = minProject.dataForms.filter(function(df){
            return df.title === formName;
        });
        if(formsFound.length > 0){
            return formsFound[0];
        }
    },

    /**
     * Finds the value of the field in a form in a min project.
     */
    getFormFieldVal: function(stdinJsonObj, formName, fieldName){
        var form = this.getForm(stdinJsonObj, formName);
        if(form){
            return form.fields[fieldName];
        }
    },

    /**
     * Makes an http request.
     * opts = node request options plus xBody and xResponseCallback
     * xResponseCallback and xBody are NOT required
     * https://nodejs.org/api/http.html#http_http_request_options_callback
     */
    httpRequest: function(opts){
        console.log("HTTP " + opts.method + " request to " + this.getUrlFromRequestOptions(opts));
        this.debugLog(JSON.stringify(opts));
        var self = this;
        var req = http.request(opts, function(responseObj) {
            self.debugLog('STATUS: ' + responseObj.statusCode);
            self.debugLog('HEADERS: ' + JSON.stringify(responseObj.headers));

            responseObj.setEncoding('utf8');
            var responseBody = "";

            responseObj.on('data', function (chunk) {
                responseBody += chunk;
                self.debugLog('BODY: ' + chunk);
            });

            responseObj.on('end', function() {
                if(opts.xResponseCallback){
                    opts.xResponseCallback(responseObj, responseBody);
                } else {
                    self.defaultResponseCallback(responseObj, responseBody);
                }
            });
        });

        req.on('error', function(e) {
            console.log("Unable to connect to server.");
            throw e;
        });

        if(opts.xBody){
            req.write(opts.xBody);
        }
        req.end();
    },

    /**
     * Utility to concat request options into URL.
     */
    getUrlFromRequestOptions: function(opts){
        return opts.protocol + "//" + opts.hostname + ":" + opts.port + opts.path;
    },

    /**
     * Default HTTP response handler.  This is used if you 
     * don't pass a response handler to the methods in this library.
     */
    defaultResponseCallback: function(responseObj, responseBody){
        if(responseObj.statusCode === 200){
            console.log("Success.");
        } else {
            console.log('STATUS: ' + responseObj.statusCode);
            console.log('HEADERS: ' + JSON.stringify(responseObj.headers));
            console.log("RESPONSE BODY: " + responseBody);
            throw new Error("Unable to successfully submit request.");
        }
    },

    /**
     * Default HTTP response handler for SPIDAmin.  This is used if you 
     * don't pass a response handler to the methods in this library.
     */
    minDefaultResponseCallback: function(responseObj, responseBody){
        if(responseObj.statusCode === 200){
            var responseBodyObj = JSON.parse(responseBody);
            if(responseBodyObj.result && responseBodyObj.result.id){
                console.log("Successfully updated SPIDAmin project.");
            } else {
                console.log("RESPONSE BODY: " + responseBody);
            }
        } else {
            console.log('STATUS: ' + responseObj.statusCode);
            console.log('HEADERS: ' + JSON.stringify(responseObj.headers));
            console.log("RESPONSE BODY: " + responseBody);
            throw new Error("Unable to update SPIDAmin project.");
        }
    },

    /**
     * Sends min project changes back to the min server.
     * stdinJsonObj: json object passed to a webhook
     * project: an object that conforms to the project schema:
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/project.schema
     * responseCallback: function to handle response (NOT required)
     */
    updateMinProject: function(stdinJsonObj, project, responseCallback){
        var parsedUrl = url.parse(stdinJsonObj.minServer);
        var body = querystring.stringify({
            'project_json' : JSON.stringify(project)
        });

        var requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/projectmanager/projectAPI/createOrUpdate?apiToken=' + stdinJsonObj.apiToken,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': body.length
            },
            xBody: body,
            xResponseCallback: responseCallback
        };

        this.httpRequest(requestOptions);
    },

    /**
     * Adds project codes to the min project passed in.
     * stdinJsonObj: json object passed to a webhook
     * projectCodes: an array of objects that conform to the project_code schema:
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/project_code.schema
     * responseCallback: function to handle response (NOT required)
     */
    postProjectCodesBackToMin: function(stdinJsonObj, projectCodes, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: stdinJsonObj.payload.part.id,
            projectCodes: projectCodes
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Sets the status of the min project passed in.
     * stdinJsonObj: json object passed to a webhook
     * newStatus: event name string
     * responseCallback: function to handle response (NOT required)
     */
    postStatusBackToMin: function(stdinJsonObj, newStatus, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: stdinJsonObj.payload.part.id,
            status: {
                current: newStatus
            }
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Update form on min project passed in.
     * stdinJsonObj: json object passed to a webhook
     * dataForm: an object that conforms to the form schema:
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/general/form.schema
     * responseCallback: function to handle response (NOT required)
     */
    postFormUpdateBackToMin: function(stdinJsonObj, dataForm, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: stdinJsonObj.payload.part.id,
            dataForms: [dataForm]
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Adds log messages to the min project passed in.
     * stdinJsonObj: json object passed to a webhook
     * logMessage: an object that conforms to the logMessage schema:
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/log_message.schema
     * responseCallback: function to handle response (NOT required)
     */
    postLogMessageBackToMin: function(stdinJsonObj, logMessage, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var parsedUrl = url.parse(stdinJsonObj.minServer);
        var body = querystring.stringify({
            'project_id' : stdinJsonObj.payload.part.id,
            'log_message_json' : JSON.stringify(logMessage)
        });
        var requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/projectmanager/projectAPI/addLogMessage?apiToken=' + stdinJsonObj.apiToken,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': body.length
            },
            xBody: body,
            xResponseCallback: responseCallback
        };

        this.httpRequest(requestOptions);
    }

};
