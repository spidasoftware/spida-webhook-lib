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
     * Convert stdin to a json object and pass into the Handler.
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
     * opts: node request options plus xBody and xResponseHandler
     *       https://nodejs.org/api/http.html#http_http_request_options_callback
     *       xErrorHandler, xResponseHandler, and xBody are NOT required
     */
    httpRequest: function(opts){
        var self = this;
        console.log("HTTP " + opts.method + " request to " + self.getUrlFromRequestOptions(opts));
        this.debugLog(JSON.stringify(opts));
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
                if(opts.xResponseHandler){
                    opts.xResponseHandler(responseObj, responseBody);
                } else {
                    self.defaultResponseHandler(responseObj, responseBody);
                }
            });
        });

        req.on('error', opts.xErrorHandler ? opts.xErrorHandler : self.defaultErrorHandler);

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
     * Default http request error handler.  This is used if you 
     * don't pass an error handler to the methods in this library.
     *
     * error: the error that occurred making the request
     */
    defaultErrorHandler: function(error){
        console.log("Error making request to server: " + error.message);
        throw error;
    },

    /**
     * Default HTTP response handler.  This is used if you 
     * don't pass a response handler to the methods in this library.
     *
     * responseObj: a node http response object
     * responseBody: the string body of the response
     * returns true if successful
     */
    defaultResponseHandler: function(responseObj, responseBody){
        if(responseObj.statusCode === 200){
            console.log("Success.");
            return true
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
     * returns true if successful
     */
    minDefaultResponseHandler: function(responseObj, responseBody){
        if(responseObj.statusCode === 200){
            var responseBodyObj = JSON.parse(responseBody);
            if(responseBodyObj.result && responseBodyObj.result.id){
                console.log("Successfully updated SPIDAmin project.");
                return true
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
     * minProjectHandler: function to pass stdinJsonObj and minProject json object
     */
    getMinProject: function(stdinJsonObj, projectId, details, minProjectHandler){
        var parsedUrl = url.parse(stdinJsonObj.minServer);

        var requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: '/projectmanager/projectAPI/getProjects?apiToken=' + stdinJsonObj.apiToken + 
                  '&project_ids=[' + projectId + ']&details=' + !!details,
            method: 'GET',
            xResponseHandler: function(nodeResponse, responseBody){
                var minProject = JSON.parse(responseBody).result.projects[0];
                minProjectHandler(stdinJsonObj, minProject);
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
     * responseHandler: function to handle response (NOT required)
     */
    updateMinProject: function(stdinJsonObj, project, responseHandler){
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
            xResponseHandler: responseHandler
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
     * responseHandler: function to handle response (NOT required)
     */
    postProjectCodesBackToMin: function(stdinJsonObj, projectId, projectCodes, responseHandler){
        responseHandler = responseHandler ? responseHandler : this.minDefaultResponseHandler;
        var project = {
            id: projectId,
            projectCodes: projectCodes
        };
        this.updateMinProject(stdinJsonObj, project, responseHandler);
    },

    /**
     * Sets the status of the min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * newStatus: event name string
     * responseHandler: function to handle response (NOT required)
     */
    postStatusBackToMin: function(stdinJsonObj, projectId, newStatus, responseHandler){
        responseHandler = responseHandler ? responseHandler : this.minDefaultResponseHandler;
        var project = {
            id: projectId,
            status: {
                current: newStatus
            }
        };
        this.updateMinProject(stdinJsonObj, project, responseHandler);
    },

    /**
     * Update form on min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * dataForm: an object that conforms to the form schema
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/general/form.schema
     * responseHandler: function to handle response (NOT required)
     */
    postFormUpdateBackToMin: function(stdinJsonObj, projectId, dataForm, responseHandler){
        responseHandler = responseHandler ? responseHandler : this.minDefaultResponseHandler;
        var project = {
            id: projectId,
            dataForms: [dataForm]
        };
        this.updateMinProject(stdinJsonObj, project, responseHandler);
    },

    /**
     * Adds log messages to the min project passed in.
     *
     * stdinJsonObj: json object passed to a webhook
     * projectId: the min project id number
     * logMessage: an object that conforms to the logMessage schema
     *   https://github.com/spidasoftware/schema/blob/master/resources/v1/schema/spidamin/project/log_message.schema
     * responseHandler: function to handle response (NOT required)
     */
    postLogMessageBackToMin: function(stdinJsonObj, projectId, logMessage, responseHandler){
        responseHandler = responseHandler ? responseHandler : this.minDefaultResponseHandler;
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
            xResponseHandler: responseHandler
        };

        this.httpRequest(requestOptions);
    }

};
