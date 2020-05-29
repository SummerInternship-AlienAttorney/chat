var express = require('express');
var app = express();
var server = require('http').Server(app)
var io = require('socket.io')();
var uuid = require('node-uuid');
var Q = require('q');
var _ = require("underscore")
var dbFunctions = require('./dbStore/dbFunctions');
var config = require('./config');
var mail = require('./mail');	//Configure mail.js and un-comment the mail code
var btoa = require('btoa');		//Password is btoa hashed 


var botT = require('./data_js/botTriggers');
var botR = require('./data_js/botResponses');
var chatbotProfessional = require('./data_js/chatbot-professional');
var chatbotFriendly = require('./data_js/chatbot-friendly');
var chatbotCaring = require('./data_js/chatbot-caring');
var chatbotWitty = require('./data_js/chatbot-witty');
var qa1 = require('./data_js/qa1');
var smalltalkQs = require('./data_js/smalltalkquestions');
var smalltalkRs = require('./data_js/smalltalkresponses');


// bot can do math
const re = /(?:(?:^|[-+_*/])(?:\s*-?\d+(\.\d+)?(?:[eE][+-]?\d+)?\s*))+$/;


var admins = {};
var users = {};

dbFunctions.ConnectToRedis(startApp);

app.get('/', function(req, res) {
	res.sendFile(__dirname + '/views/client.html');
});

app.get('/ping', function(req, res) {
	res.setHeader('Access-Control-Allow-Origin', config.parentDomain);
	res.send("OK");
});

app.get(config.admin_url, function(req, res) {
	res.sendFile(__dirname + '/views/admin.html');
});

app.use(express.static(__dirname + '/public'));

io.on('connection', function(socket) {
	//Login Admin
	socket.on('login', function(data) {
		if (btoa(data.password) != config.key)
			socket.emit('login', {
				login: false,
				err: "Invalid Login"
			})
		else {
			if (_.find(config.admin_users, function(admin) {
					return (admin == data.admin);
				})) {
				if (admins[data.admin]) {
					socket.emit('login', {
						login: false,
						err: "Already Logged In"
					})
				} else {
					socket.emit('login', {
						login: true
					})
				}
			} else {
				socket.emit('login', {
					login: false,
					err: "Invalid Login"
				})
			}
		}
	});	
	//Init admin
	socket.on('add admin', function(data) {
		this.isAdmin = data.isAdmin;
		socket.username = data.admin;

		_.each(admins, function(adminSocket) {
			adminSocket.emit("admin added", socket.username)
			socket.emit("admin added", adminSocket.username)
		});

		admins[socket.username] = socket;

		//If some user is already online on chat
		if (Object.keys(users).length > 0) {
			_.each(users, function(userSocket) {
				dbFunctions.getMessages(userSocket.roomID, 0)
					.then(function(history) {
						var len = history.length;
						var userSocket = users[history[len - 1]];
						history.splice(-1, 1);
						socket.join(userSocket.roomID);
						socket.emit("New Client", {
							roomID: userSocket.roomID,
							history: history,
							details: userSocket.userDetails,
							justJoined: true
						})
					})
			});
		}
	});	
	//Init user
	socket.on('add user', function(data) {
		socket.isAdmin = false;
		if (data.isNewUser) {
			data.roomID = uuid.v4();
			dbFunctions.setDetails(data);
			socket.emit("roomID", data.roomID);
		}
		socket.roomID = data.roomID;
		//Fetch user details
		dbFunctions.getDetails(socket.roomID)
			.then(function(details) {
				socket.userDetails = details;
			})
			.catch(function(error) {
				console.log("Line 95 : ", error)
			})
			.done();
		socket.join(socket.roomID);
		var newUser = false;
		if (!users[socket.roomID]) {  // Check if different instance of same user. (ie. Multiple tabs)
			users[socket.roomID] = socket;
			newUser = true;
		}
		
		//Fetch message history
		dbFunctions.getMessages(socket.roomID, 0)
			.then(function(history) {
				history.splice(-1, 1)
				socket.emit('chat history', {
					history: history,
					getMore: false
				});
				if (Object.keys(admins).length == 0) {
					//Tell user he will be contacted asap and send admin email
					
					// socket.emit('log message', "Thank you for reaching us." +
					// 	" Please leave your message here and we will get back to you shortly.");
					socket.emit('log message', "Hi, this is bot." +
						" How can I help you today?");
					/*mail.alertMail();*/
				} else {
					
					if (newUser) {
						socket.emit('log message', "Hello" + socket.userDetails[0] + ", How can I help you?");
						//Make all available admins join this users room.
						_.each(admins, function(adminSocket) {
							adminSocket.join(socket.roomID);
							adminSocket.emit("New Client", {
								roomID: socket.roomID,
								history: history,
								details: socket.userDetails,
								justJoined: false
							})
						});
					}
					else socket.emit('log message', "Welcome back " + socket.userDetails[0] + ", How help ");
				}
			})
			.catch(function(error) {
				console.log("Line 132 : ", error)
			})
			.done();
		dbFunctions.getMsgLength(socket.roomID)
			.then(function(len) {
				socket.MsgHistoryLen = (len * -1) + 10;
				socket.TotalMsgLen = (len * -1);
			})
			.catch(function(error) {
				console.log("Line 140 : ", error)
			})
			.done();
	});

	socket.on('chat message', function(data) {
		if (data.roomID === "null")
			data.roomID = socket.roomID;
		data.isAdmin = socket.isAdmin;
		dbFunctions.pushMessage(data);

		socket.broadcast.to(data.roomID).emit('chat message', data);

		// console.log(Object.getOwnPropertyNames(data));

		var adminBot = {
			roomID : data.roomID,
			timestamp : data.timestamp,
			isAdmin : true,
			msg : ""
		};
		
		var gotResponse = false;


		// hard coded section
		// anything in array is a substring of msg
		//bot.greetings.includes(data.msg.toLowerCase())
		if (botT.greetings.includes(data.msg.toLowerCase())) {
			adminBot.msg = botR.greetings[Math.floor(Math.random() * botR.greetings.length)];
			adminBot.msg = adminBot.msg.charAt(0).toUpperCase() + adminBot.msg.slice(1);
			gotResponse = true;
		}

		else if (botT.bye.some(v => data.msg.toLowerCase().includes(v))) {
			adminBot.msg = botR.greetings[Math.floor(Math.random() * botR.greetings.length)];
			gotResponse = true;
		}
		else if (botT.thanks.some(v => data.msg.toLowerCase().includes(v))) {
			adminBot.msg = botR.thanks[Math.floor(Math.random() * botR.thanks.length)];
			gotResponse = true;
		}


		// smalltalk questions and responses
		if (!gotResponse) {
			for (i = 0; i < smalltalkQs.length; i++) {
				if (smalltalkQs[i].Question.toLowerCase().includes(data.msg.toLowerCase())) {
						console.log("here");
						console.log(smalltalkQs[i].Question.toLowerCase().includes(data.msg.toLowerCase()))
						console.log(data.msg.toLowerCase().includes(smalltalkQs[i].Question.toLowerCase()) )
						console.log(smalltalkQs[i].Question.toLowerCase())
					

					var answers = smalltalkRs[smalltalkQs[i].Answer];

					console.log(smalltalkQs[i].Answer);
					console.log(answers);

					adminBot.msg = answers[Math.floor(Math.random() * answers.length)];
					gotResponse = true;
					break;
				}
			}
		}

		//bot does math //issue: parentheses calculations and question marks
		if (!gotResponse) {
			if (re.test(data.msg)) {
				var exp = data.msg.replace(/[^\d-+*/]/g,'');
				console.log(exp);
				adminBot.msg = eval(exp);
				gotResponse = true;
			}
		}


		
		// conversational chatbot responses from Microsoft
		// https://github.com/Microsoft/BotBuilder-PersonalityChat/tree/master/CSharp/Datasets
		// only examine if the basics were not met
		if (!gotResponse) {
			for (i = 0; i < chatbotProfessional.length; i++) {
				if (chatbotProfessional[i].Question.toLowerCase().includes(data.msg.toLowerCase())) {

					adminBot.msg = chatbotProfessional[i].Answer;
					gotResponse = true;
					console.log("Professional");
					break;
				}
			}
		}
		if (!gotResponse) {
			for (i = 0; i < chatbotFriendly.length; i++) {
				if (chatbotFriendly[i].Question.toLowerCase().includes(data.msg.toLowerCase())) {

					adminBot.msg = chatbotFriendly[i].Answer;
					gotResponse = true;
					break;
				}
			}
		}		
		if (!gotResponse) {
			for (i = 0; i < chatbotCaring.length; i++) {
				if (chatbotCaring[i].Question.toLowerCase().includes(data.msg.toLowerCase()) ) {
				//	||  data.msg.toLowerCase().includes(chatbotCaring[i].Question.toLowerCase()) ) {

					adminBot.msg = chatbotCaring[i].Answer;
					gotResponse = true;
					break;
				}
			}
		}
		if (!gotResponse) {
			for (i = 0; i < chatbotWitty.length; i++) {
				if (chatbotWitty[i].Question.toLowerCase().includes(data.msg.toLowerCase()) ) {

					adminBot.msg = chatbotWitty[i].Answer;
					gotResponse = true;
					break;
				}
			}
		}



		// first q and a dataset wikipedia
		if (!gotResponse) {
			for (i = 0; i < qa1.length; i++) {
				if (qa1[i].Question.toLowerCase().includes(data.msg.toLowerCase()) 
					||  data.msg.toLowerCase().includes(qa1[i].Question.toLowerCase()) ) {

					adminBot.msg = qa1[i].Answer;
					gotResponse = true;
					break;
				}
			}
		}

		console.log(gotResponse);
		// hardcoded customer service style questions
		if (!gotResponse) {
			if (botT.contact.some(v => data.msg.toLowerCase().includes(v))) {
				adminBot.msg += " " + botR.contact[0];
				gotResponse = true;
			}
	
			if (botT.faq.some(v => data.msg.toLowerCase().includes(v))) {
				adminBot.msg += botR.faq[0];
				gotResponse = true;
			}
		}
		
		

		// only chat from adminBot if no admin is logged in
		if (Object.keys(admins).length == 0) {
			if (adminBot.msg != "") {

				//add delay so chatbot seems more real
				setTimeout(() => {
					socket.emit('chat message', adminBot);
				   }, 1000);
				
				dbFunctions.pushMessage(adminBot);
			}			
		}
		
		// socket.emit('log message', data.msg);
		// socket.emit('log message', socket.history[0]);
	});

	socket.on("typing", function(data) {
		socket.broadcast.to(data.roomID).emit("typing", {
			isTyping: data.isTyping,
			person: data.person,
			roomID: data.roomID
		});
	});

	socket.on('disconnect', function() {
		if (socket.isAdmin) {
			delete admins[socket.username];
			_.each(admins, function(adminSocket) {
				adminSocket.emit("admin removed", socket.username)
			});
		} else {
			if (io.sockets.adapter.rooms[socket.roomID]) {
				var total = io.sockets.adapter.rooms[socket.roomID]["length"];
				var totAdmins = Object.keys(admins).length;
				var clients = total - totAdmins;
				if (clients == 0) {
					//check if user reconnects in 4 seconds 
					setTimeout(function() {
						if (io.sockets.adapter.rooms[socket.roomID])
							total = io.sockets.adapter.rooms[socket.roomID]["length"];
						totAdmins = Object.keys(admins).length;
						if (total <= totAdmins) {
							/*mail.sendMail({
								roomID: socket.roomID,
								MsgLen: socket.TotalMsgLen,
								email: socket.userDetails
							});*/
							delete users[socket.roomID];
							socket.broadcast.to(socket.roomID).emit("User Disconnected", socket.roomID);
							_.each(admins, function(adminSocket) {
								adminSocket.leave(socket.roomID)
							});
						}
					}, 4000);
				}
			} else {
				if (socket.userDetails)
					/*mail.sendMail({
						roomID: socket.roomID,
						MsgLen: socket.TotalMsgLen,
						email: socket.userDetails
					});*/
				delete users[socket.roomID];
			}
		}
	});

	socket.on('poke admin', function(targetAdmin) {
		admins[targetAdmin].emit("poke admin", {})
	});

	socket.on('client ack', function() {
		for (adminSocket in admins) {
			if (!admins.hasOwnProperty(adminSocket)) {
				continue;
			}
			admins[adminSocket].emit("client ack", {})
		}
	});

	socket.on("more messages", function() {
		if (socket.MsgHistoryLen < 0) {
			dbFunctions.getMessages(socket.roomID, socket.MsgHistoryLen)
				.then(function(history) {
					history.splice(-1, 1)
					socket.emit('more chat history', {
						history: history
					});
				})
			socket.MsgHistoryLen += 10;
		}
	});
});

function startApp(isSuccess) {
	if (isSuccess) {
		server.listen(config.web_port, function() {
			console.log('Server started ' + config.web_port + ' at ' +
				(new Date().toLocaleString().substr(0, 24)));
		});
		io.attach(server, {
			'pingInterval': 15000,
			'pingTimeout': 15000
		});
	} else {
		console.log("Server failed to start.");
	}
}