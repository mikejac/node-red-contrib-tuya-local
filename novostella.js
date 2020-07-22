const TuyaDev = require('tuyapi');
const {getHumanTimeStamp} = require('./lib/utils');
//const {keyRename,getHumanTimeStamp,checkValidJSON,filterCommandByte} = require('./lib/utils');
const formats = require('./formatvalues.js');

module.exports = function(RED) {

	function TuyaNovostellaNode(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		var set_timeout = true
		this.Name = config.devName;
		this.Id = config.devId;
		this.Key = config.devKey;
		this.Ip = config.devIp;
		this.version = config.protocolVer;
		this.topicDelim = '/';
		//this.renameSchema = config.renameSchema;
		//this.filterCB = config.filterCB;
		const dev_info =  {name:this.Name,ip:this.Ip,id:this.Id};
		const device = new TuyaDev({
			id: this.Id,
			key: this.Key,
			ip: this.Ip,
			version: this.version});

		function connectToDevice(timeout,req) {
			device.find({'options': {'timeout':timeout}}).then( () => {
				node.status({fill:"yellow",shape:"dot",text:"connecting"});
				node.log(req);
				device.connect().then( () => {
				}, (reason) => { 
					node.status({fill:"red",shape:"ring",text:"failed: " + reason});
				});
			});
		}

		function disconnectDevice(deleted) {
			set_timeout = deleted ? false : true;
			device.disconnect();
		}

		function setDevice(req) {
			if ( req == "request" ) {
				device.get({"schema":true});
			} else if ( req == "connect" ) {
				// node.log('Connection requested by input');
				connectToDevice(10,'Connection requested by input for device: ' + this.Name );
			} else if ( req == "disconnect" ) {
				node.log("Disconnection requested by input for device: " + this.Name)
				device.disconnect();
			} else if (req == "toggle") {
				device.toggle();
			} else if ( typeof req == "boolean" ) {
				device.set({set: req}).then( () => {
					node.status({fill:"green",shape:"dot",text: 'set success at:' + getHumanTimeStamp()});
				}, (reason) => {
					node.status({fill:"red",shape:"dot",text: 'set state failed:' + reason});
				});
			} else if ( "dps" in req ) {
				console.log(req)
				device.set(req);
			} else if ( "multiple" in req) {
				device.set({
					multiple:true,
					data: req.data
				});
			}
		}

		connectToDevice(10,'Deploy connection request for device ' + this.Name);

		device.on('disconnected', () => {
			this.status({fill:"red",shape:"ring",text:"disconnected from device"});
			dev_info.available = false
			msg = {data:dev_info}
			node.send(msg);
			if (set_timeout) {
				timeout = setTimeout(connectToDevice, 10000, 10, 'set timeout for re-connect');
			}
		});

		device.on('connected', () => {
			this.status({fill:"green",shape:"dot",text: this.Ip + " at " + getHumanTimeStamp()});
			try	{
				clearTimeout(timeout)	
			} catch(e) {
				node.log("No timeout defined for " + this.Name + ", probably NodeRED starting")
			}
			
		});

		device.on('error', error => {
			this.status({fill:"red",shape:"ring",text:"error: " + error});
			node.warn(error + " device: " + this.Name);
			if (error.toString().includes("Error from socket")){
				try	{
					node.log("error: Trying to clear a possible timeout timer for device " + this.Name )
					clearTimeout(timeout)	
				} catch(e) {
					node.log("error: No timeout defined, device " + this.Name + " is probably not powered")
				}
			}
		});

		device.on('data', (data,commandByte) => {
			if ("commandByte" !== null ) {
				dev_info.available = true;
				//if (this.renameSchema !== undefined || this.renameSchema !== null) {
				//	data.dps = checkValidJSON(this.renameSchema) ? keyRename(data.dps,JSON.parse(this.renameSchema)) : data.dps;
				//}
				msg = {data:dev_info,commandByte:commandByte,payload:data};
				//if (this.filterCB !== "") {
				//	node.send(filterCommandByte(msg,this.filterCB));
				//} else {
					node.send(msg);
				//}
			}
		});

		node.on('input', function(msg) {
			let topicArr = String(msg.topic).split(node.topicDelim);
			let topic    = topicArr[topicArr.length - 1];   // get last part of topic
			
			try {
				if (topic.toUpperCase() === 'ON') {
					let on = formats.FormatValue(formats.Formats.BOOL, 'on', msg.payload);
					setDevice(on);
				} else if (topic.toUpperCase() === 'WHITE') {
					let d = {
						multiple: true,
						data: {
							"20": true,
							"21": "white",
							"22": 1000,		// brightness [10:1000]
							"23": 0			// temperature [0:1000]
						}
					};

					if (msg.payload.hasOwnProperty('brightness')) {
						let v = formats.FormatValue(formats.Formats.INT, 'brightness', msg.payload.brightness);
						d.data[22] = v;
					}

					if (msg.payload.hasOwnProperty('temperature')) {
						let v = formats.FormatValue(formats.Formats.INT, 'temperature', msg.payload.temperature);
						d.data[23] = v;
					}

					setDevice(d);
				} else if (topic.toUpperCase() === 'COLOR') {

				} else {
					setDevice(msg.payload);
				}
			} catch (err) {
                RED.log.error(err);
            }
		});

		this.on('close', function(removed, done) {
			if (removed) {
				  // This node has been deleted disconnect device and not set a timeout for reconnection
				node.log("Node removal, gracefully disconnect device: " + this.Name);
				device.isConnected() ? disconnectDevice(true) : node.log("Device " + this.Name + "not connected on removal");
			} else {
				// this node is being restarted, disconnect the device gracefully or connection will fail. Do not set a timeout
				node.log("Node re-deploy, gracefully disconnect device: " + this.Name);
				device.isConnected() ? disconnectDevice(true) : node.log("Device " + this.Name + "not connected on re-deploy");
			}
			done();
		});
	}
	RED.nodes.registerType("tuya-novostella", TuyaNovostellaNode);
}
