var url = require('url');
var http = require('http');
var querystring = require('querystring');

var hook = {

    /**
     * This value can be changed in your script or by passing a logLevel 
     * property in a json object in the webhook-tool 'Script Parameter' field.
     */
    logLevel: "info", 

    /**
     * These are all the possible log levels.  These should not be modified.
     */
    LOG_LEVELS: ["none", "error", "info", "debug"],

    /**
     * A simple logger for logging at different levels.
     * hook.log.error("printed if the log level is error only")
     * hook.log.info("printed if the log level is info or debug")
     * hook.log.debug("printed if the log level is error, info, or debug")
     * NOTE: Nothing will be printed if log level is 'none'.
     */
    log: {
        shouldLog: function(level){
            return hook.LOG_LEVELS.indexOf(hook.logLevel.toLowerCase()) >= hook.LOG_LEVELS.indexOf(level);
        },
        error: function(){ if(this.shouldLog("error")){ console.error.apply(hook, arguments); }},
        info: function(){ if(this.shouldLog("info")){ console.info.apply(hook, arguments); }},
        debug: function(){ if(this.shouldLog("debug")){ console.log.apply(hook, arguments); }}
    },

    /**
     * Convert stdin to a json object and pass into the Handler.
     * Modified version of https://gist.github.com/kristopherjohnson/5065599
     * NOTE: logLevel can be overridden if scriptParam JSON has a logLevel property.
     *       example scriptParam: { "otherKey":"otherValue", "logLevel":"debug" }
     *
     * stdinHandler: after parsing stdin this method will be passed the parsed json object
     */
    doWithStdinJson: function(stdinHandler){
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
            
            //check for logLevel override in scriptParam
            hook.logLevel = JSON.parse(parsedStdin.scriptParam).logLevel || hook.logLevel;
            
            hook.log.debug("json passed into webhook: \n" + JSON.stringify(parsedStdin) + '\n');
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
                hook.log.info("Missing form named '" + formName + "'.");
            }
        } else {
            hook.log.info("No forms on project.");
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
                hook.log.info("Missing field named '" + fieldName + "' on form named '" + formName + "'.");
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
        hook.log.info("HTTP " + opts.method + " request to " + self.getUrlFromRequestOptions(opts));
        hook.log.debug("httpRequest options: "+JSON.stringify(opts));
        var req = http.request(opts, function(responseObj) {
            hook.log.debug('STATUS: ' + responseObj.statusCode);
            hook.log.debug('HEADERS: ' + JSON.stringify(responseObj.headers));

            responseObj.setEncoding('utf8');
            var responseBody = "";

            responseObj.on('data', function (chunk) {
                responseBody += chunk;
            });

            responseObj.on('end', function() {
                hook.log.debug("RESPONSE BODY: " + responseBody + '\n');
                if(opts.xResponseHandler){
                    opts.xResponseHandler(responseObj, responseBody);
                } else {
                    self.defaultResponseHandler(responseObj, responseBody);
                }
            });
        });

        req.on('error', opts.xErrorHandler || self.defaultErrorHandler);

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
        hook.log.error("Error making request to server: " + error.message);
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
            hook.log.info("Success.");
            return true
        } else {
            hook.log.error('STATUS: ' + responseObj.statusCode);
            hook.log.error('HEADERS: ' + JSON.stringify(responseObj.headers));
            hook.log.error("RESPONSE BODY: " + responseBody + '\n');
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
                hook.log.info("Successfully updated SPIDAmin project " + responseBodyObj.result.id + ".");
                return true
            } else {
                hook.log.error("RESPONSE BODY: " + responseBody);
            }
        } else {
            hook.log.error('STATUS: ' + responseObj.statusCode);
            hook.log.error('HEADERS: ' + JSON.stringify(responseObj.headers));
            hook.log.error("RESPONSE BODY: " + responseBody);
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
        var projectJsonString = JSON.stringify(project);
        hook.log.debug("projectJsonString: " + projectJsonString);
        var body = querystring.stringify({
            'project_json' : projectJsonString
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
        responseHandler = responseHandler || this.minDefaultResponseHandler;
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
        responseHandler = responseHandler || this.minDefaultResponseHandler;
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
        responseHandler = responseHandler || this.minDefaultResponseHandler;
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
        responseHandler = responseHandler || this.minDefaultResponseHandler;
        var parsedUrl = url.parse(stdinJsonObj.minServer);
        var logMessageJsonString = JSON.stringify(logMessage);
        hook.log.debug("logMessageJsonString: " + logMessageJsonString);
        var body = querystring.stringify({
            'project_id' : projectId,
            'log_message_json' : logMessageJsonString
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

module.exports = hook;
