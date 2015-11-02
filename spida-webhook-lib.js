var url = require('url');
var http = require('http');
var querystring = require('querystring');

module.exports = {

    enableDebugLog: false,

    /**
     * Log if extra logging.
     *
     * logMessage: string to log if debugging
     */
    debugLog: function(logMessage){
        if(this.enableDebugLog){
            console.log(logMessage);
        }
    },

    /**
     * Convert stdin to a json object and pass into the callback.
     * Modified version of https://gist.github.com/kristopherjohnson/5065599
     *
     * stdinHandler: after parsing stdin this method will be passed the parsed json object
     */
    doWithStdinJson: function(stdinHandler){
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
            self.debugLog("json passed into webhook: \n" + JSON.stringify(parsedStdin) + '\n');
            stdinHandler(parsedStdin);
        });
    },

    /**
     * Finds the form in a min project.
     *
     * minProject: min project json object
     * formName: the title of a min data form
     */
    getForm: function(minProject, formName){
        if(minProject.dataForms){
            var formsFound = minProject.dataForms.filter(function(df){
                return df.title === formName;
            });
            if(formsFound.length > 0){
                return formsFound[0];
            } else {
                console.log("Missing form named '" + formName + "'.");
            }
        } else {
            console.log("No forms on project.");
        }
    },

    /**
     * Finds the value of the field in a form in a min project.
     *
     * minProject: min project json object
     * formName: the title of a min data form
     * fieldName: the min form field label
     */
    getFormFieldVal: function(minProject, formName, fieldName){
        var form = this.getForm(minProject, formName);
        if(form){
            if(form.fields.hasOwnProperty(fieldName)){
                return form.fields[fieldName];
            } else {
                console.log("Missing field named '" + fieldName + "' on form named '" + formName + "'.");
            }
        }
    },

    /**
     * Makes an http request.
     *
     * opts: node request options plus xBody and xResponseCallback
     *       https://nodejs.org/api/http.html#http_http_request_options_callback
     *       xResponseCallback and xBody are NOT required
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
            });

            responseObj.on('end', function() {
                self.debugLog("RESPONSE BODY: " + responseBody + '\n');
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
     *
     * opts: node request options object
     */
    getUrlFromRequestOptions: function(opts){
        return opts.protocol + "//" + opts.hostname + ":" + opts.port + opts.path;
    },

    /**
     * Default HTTP response handler.  This is used if you 
     * don't pass a response handler to the methods in this library.
     *
     * responseObj: a node http response object
     * responseBody: the string body of the response
     */
    defaultResponseCallback: function(responseObj, responseBody){
        if(responseObj.statusCode === 200){
            console.log("Success.");
        } else {
            console.log('STATUS: ' + responseObj.statusCode);
            console.log('HEADERS: ' + JSON.stringify(responseObj.headers));
            console.log("RESPONSE BODY: " + responseBody + '\n');
            throw new Error("Unable to successfully submit request.");
        }
    },

    /**
     * Default HTTP response handler for SPIDAmin.  This is used if you 
     * don't pass a response handler to the methods in this library.
     *
     * responseObj: a node http response object
     * responseBody: the string body of the response
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
     * Get min project from the min server.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the id number of the min project
     * details: boolean value for details query param
     * minProjectCallback: function to pass stdinJsonObj and minProject json object
     */
    getMinProject: function(stdinJsonObj, projectId, details, minProjectCallback){
        var parsedUrl = url.parse(stdinJsonObj.minServer);

        var requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/projectmanager/projectAPI/getProjects?apiToken=' + stdinJsonObj.apiToken + 
                  '&project_ids=[' + projectId + ']&details=' + !!details,
            method: 'GET',
            xResponseCallback: function(nodeResponse, responseBody){
                var minProject = JSON.parse(responseBody).result.projects[0];
                minProjectCallback(stdinJsonObj, minProject);
            }
        };

        this.httpRequest(requestOptions);
    },

    /**
     * Sends min project changes back to the min server.
     *
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
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * projectCodes: an array of objects that conform to the project_code schema
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/project_code.schema
     * responseCallback: function to handle response (NOT required)
     */
    postProjectCodesBackToMin: function(stdinJsonObj, projectId, projectCodes, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: projectId,
            projectCodes: projectCodes
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Sets the status of the min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * newStatus: event name string
     * responseCallback: function to handle response (NOT required)
     */
    postStatusBackToMin: function(stdinJsonObj, projectId, newStatus, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: projectId,
            status: {
                current: newStatus
            }
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Update form on min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * dataForm: an object that conforms to the form schema
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/general/form.schema
     * responseCallback: function to handle response (NOT required)
     */
    postFormUpdateBackToMin: function(stdinJsonObj, projectId, dataForm, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var project = {
            id: projectId,
            dataForms: [dataForm]
        };
        this.updateMinProject(stdinJsonObj, project, responseCallback);
    },

    /**
     * Adds log messages to the min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * logMessage: an object that conforms to the logMessage schema
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/log_message.schema
     * responseCallback: function to handle response (NOT required)
     */
    postLogMessageBackToMin: function(stdinJsonObj, projectId, logMessage, responseCallback){
        responseCallback = responseCallback ? responseCallback : this.minDefaultResponseCallback;
        var parsedUrl = url.parse(stdinJsonObj.minServer);
        var body = querystring.stringify({
            'project_id' : projectId,
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
