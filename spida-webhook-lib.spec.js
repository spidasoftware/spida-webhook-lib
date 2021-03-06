var url = require('url');
var http = require('http');
var querystring = require('querystring');
var webhook = require("./spida-webhook-lib");

var originalStdin = process.stdin;
var originalHttpRequest = webhook.httpRequest;
var originalUpdateMinProject = webhook.updateMinProject;
var reset = function(){
    Object.defineProperty(process, 'stdin', { value: this.originalStdin });
    webhook.httpRequest = originalHttpRequest;
    webhook.updateMinProject = originalUpdateMinProject;
    webhook.logLevel = 'none';
};

describe('spida-webhook', function() {
    afterEach(reset);
    beforeEach(reset);

    it('logLevel none', function() {
        //setup
        spyOn(console, 'error');
        spyOn(console, 'info');
        spyOn(console, 'log');
        webhook.logLevel = 'none';
        
        //when
        webhook.log.error('some error message');
        webhook.log.info('some info message');
        webhook.log.debug('some debug message');

        //then
        expect(console.error).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
    });

    it('logLevel error', function() {
        //setup
        spyOn(console, 'error');
        spyOn(console, 'info');
        spyOn(console, 'log');
        webhook.logLevel = 'error';
        
        //when
        webhook.log.error('some error message');
        webhook.log.info('some info message');
        webhook.log.debug('some debug message');

        //then
        expect(console.error).toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
    });

    it('logLevel info', function() {
        //setup
        spyOn(console, 'error');
        spyOn(console, 'info');
        spyOn(console, 'log');
        webhook.logLevel = 'info';
        
        //when
        webhook.log.error('some error message');
        webhook.log.info('some info message');
        webhook.log.debug('some debug message');

        //then
        expect(console.error).toHaveBeenCalled();
        expect(console.info).toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
    });

    it('logLevel debug', function() {
        //setup
        spyOn(console, 'error');
        spyOn(console, 'info');
        spyOn(console, 'log');
        webhook.logLevel = 'debug';
        
        //when
        webhook.log.error('some error message');
        webhook.log.info('some info message');
        webhook.log.debug('some debug message');

        //then
        expect(console.error).toHaveBeenCalled();
        expect(console.info).toHaveBeenCalled();
        expect(console.log).toHaveBeenCalled();
    });

    it('doWithStdinJson', function() {
        //setup
        expect(webhook.logLevel).toEqual("none"); //test default
        Object.defineProperty(process, 'stdin', {  
            value: {
                resume:function(){},
                setEncoding:function(){},
                on:function(evt, func){
                    if(evt === 'data'){
                        func('{"a":1,'); 
                        func('"scriptParam":"{\\"logLevel\\":\\"debug\\"}"}');
                    } else if(evt === 'end'){
                        func();
                    }
                }
            }
        });
        var done = jasmine.createSpy('done');
        
        //when
        webhook.doWithStdinJson(done);
        
        //then
        expect(done).toHaveBeenCalledWith(JSON.parse('{"a":1,"scriptParam":"{\\"logLevel\\":\\"debug\\"}"}'));
        expect(webhook.logLevel).toEqual("debug");
    });

    it('getForm and getFormFieldVal', function() {
        //setup
        var minProject = {
            dataForms:[{
                title: "form1",
                fields:{
                    field1: "val1",
                    field2: ""
                }
            }]
        };
        
        //when
        var val = webhook.getFormFieldVal(minProject, "form1", "field1");
        
        //then
        expect(val).toEqual("val1");
        
        //when
        var val = webhook.getFormFieldVal(minProject, "form1", "field2");
        
        //then
        expect(val).toEqual(""); //making sure empty string still get returned
        
        //when
        var val = webhook.getFormFieldVal(minProject, "form1", "MISSING");
        
        //then
        expect(val).toEqual(null);
        
        //when
        minProject.dataForms = undefined;
        
        //then
        expect(val).toEqual(null);
    });

    it('httpRequest', function() {
        //setup
        var responseObj = {
            statusCode:200, 
            setEncoding: function(){},
            on:function(evt, func){
                if(evt === 'data'){
                    func("{");
                    func("}");
                } else if(evt === 'end'){
                    func();
                }
            }
        };
        var requestEnd = jasmine.createSpy('requestEnd');
        var requestWrite = jasmine.createSpy('requestWrite');
        var requestOn = jasmine.createSpy('requestOn');
        var responseHandler = jasmine.createSpy('responseHandler');
        http.request = function(opts, handler){
            handler(responseObj);
            return {
                end: requestEnd,
                write: requestWrite,
                on: requestOn
            }
        }
        var requestOptions = {
            protocol: "test:",
            hostname: "test",
            port: 123,
            path: '/test',
            method: 'POST',
            headers: {},
            xResponseHandler: responseHandler,
            xBody: 'body'
        };
        
        //when
        webhook.httpRequest(requestOptions);
        
        //then
        expect(requestEnd).toHaveBeenCalled();
        expect(requestWrite).toHaveBeenCalled();
        expect(requestOn).toHaveBeenCalled();
        expect(responseHandler).toHaveBeenCalledWith(responseObj, "{}");
    });

    it('getMinProject', function() {
        //setup
        var stdinJsonObj = {
          "apiToken": "admin@spidasoftware.com",
          "minServer": "http://localhost:8888/"
        };
        var project = {id:1};
        var responseHandler = jasmine.createSpy('responseHandler');
        var calledHttpRequest = false;
        spyOn(webhook, 'httpRequest').andCallFake(function(opts){
            expect(opts.protocol).toEqual("http:")
            expect(opts.hostname).toEqual("localhost")
            expect(opts.port).toEqual("8888")
            expect(opts.path).toEqual('/projectmanager/projectAPI/getProjects?apiToken=admin@spidasoftware.com&project_ids=[123]&details=true')
            expect(opts.method).toEqual("GET")
            calledHttpRequest = true;
        });

        //when
        webhook.getMinProject(stdinJsonObj, 123, true, responseHandler);
        
        //then
        expect(calledHttpRequest).toBeTruthy();
    });

    it('updateMinProject', function() {
        //setup
        var stdinJsonObj = {
          "apiToken": "admin@spidasoftware.com",
          "minServer": "http://localhost:8888/"
        };
        var project = {id:1};
        var responseHandler = jasmine.createSpy('responseHandler');
        var calledHttpRequest = false;
        spyOn(webhook, 'httpRequest').andCallFake(function(opts){
            expect(opts.protocol).toEqual("http:")
            expect(opts.hostname).toEqual("localhost")
            expect(opts.port).toEqual("8888")
            expect(opts.path).toEqual('/projectmanager/projectAPI/createOrUpdate?apiToken=admin@spidasoftware.com')
            expect(opts.method).toEqual("POST")
            expect(opts.headers['Content-Type']).toEqual('application/x-www-form-urlencoded')
            expect(opts.headers['Content-Length']).toEqual(31)
            expect(opts.xResponseHandler).toEqual(responseHandler)
            expect(opts.xBody).toEqual("project_json=%7B%22id%22%3A1%7D")
            calledHttpRequest = true;
        });

        //when
        webhook.updateMinProject(stdinJsonObj, project, responseHandler);
        
        //then
        expect(calledHttpRequest).toBeTruthy();
    });

    it('postProjectCodesBackToMin', function() {
        //setup
        var stdinJsonObj = {payload:{part:{id:1}}};
        var projectCodes = [{value:"123"}];
        spyOn(webhook, 'updateMinProject').andCallFake(function(){});
        
        //when
        webhook.postProjectCodesBackToMin(stdinJsonObj, projectCodes);
        
        //then
        expect(webhook.updateMinProject).toHaveBeenCalled();
    });

    it('postStatusBackToMin', function() {
        //setup
        var stdinJsonObj = {payload:{part:{id:1}}};
        spyOn(webhook, 'updateMinProject').andCallFake(function(){});
        
        //when
        webhook.postStatusBackToMin(stdinJsonObj, "Finish");
        
        //then
        expect(webhook.updateMinProject).toHaveBeenCalled();
    });

    it('postFormUpdateBackToMin', function() {
        //setup
        var stdinJsonObj = {payload:{part:{id:1}}};
        spyOn(webhook, 'updateMinProject').andCallFake(function(){});
        
        //when
        webhook.postFormUpdateBackToMin(stdinJsonObj, {});
        
        //then
        expect(webhook.updateMinProject).toHaveBeenCalled();
    });

    it('postLogMessageBackToMin', function() {
        //setup
        var stdinJsonObj = {payload:{part:{id:1}}, minServer:"http://test/test"};
        var logMessage = {trigger:"test", message:"test", success:true, date:new Date().getTime()};
        spyOn(webhook, 'httpRequest').andCallFake(function(){});
        
        //when
        webhook.postLogMessageBackToMin(stdinJsonObj, logMessage);
        
        //then
        expect(webhook.httpRequest).toHaveBeenCalled();
    });

});
