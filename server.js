import { createServer } from "https";
import next from "next";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import mediasoup from "mediasoup";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();
const __dirname = path.resolve();
const options = {
  key: fs.readFileSync(path.resolve(__dirname, "certs", "key.pem")),
  cert: fs.readFileSync(path.resolve(__dirname, "certs", "cert.pem")),
};

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

app.prepare().then(() => {
  const httpServer = createServer(options, handler);

  const io = new Server(httpServer);
  let worker;
  let namespaces = {};
  let rooms = {};

  let transports = [];
  let producers = [];
  let consumers = [];

  const createWorker = async () => {
    worker = await mediasoup.createWorker({
      rtcMinPort: 2000,
      rtcMaxPort: 2100,
    });
    console.log(`worker pid ${worker.pid}`);

    worker.on("died", (error) => {
      // This implies something serious happened, so kill the application
      console.error("mediasoup worker has died");
      setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

    return worker;
  };

  // We create a Worker as soon as our application starts
  worker = createWorker();

  const createWebRtcTransport = async (roomName, callback) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "0.0.0.0", // replace with relevant IP address
            announcedIp: "127.0.0.1",
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await rooms[roomName].createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      // send back to the client the following prameters
      callback({
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });

      return transport;
    } catch (error) {
      console.log(error);
      callback({
        params: {
          error: error,
        },
      });
    }
  };

  io.on("connection", (socket) => {
    console.log("A user connected to the default namespace");

    socket.on("list-namespaces", () => {
      socket.emit("namespaces", Object.keys(namespaces));
    });

    socket.on("joinNamespace", (namespace) => {
      if (!namespaces[namespace]) {
        // Create the namespace dynamically if it doesn't exist
        namespaces[namespace] = io.of(`/${namespace}`);
        namespaces[namespace].on("connection", (nsSocket) => {
          namespaces[namespace].count = (namespaces[namespace].count ?? 0) + 1;

          console.log(`User connected to namespace: ${namespace}`);
          nsSocket.emit("connection-success", {
            data: `User connected to namespace: ${namespace}`,
            nsSocketId: nsSocket.id,
          });

          nsSocket.on("boot", (socketId) => {
            producers
              .filter((obj) => obj.socketId === socketId)
              .forEach((obj) => {
                obj.producer.close();
              });
            producers = producers.filter((obj) => obj.socketId !== socketId);
            consumers
              .filter((obj) => obj.socketId === socketId)
              .forEach((obj) => {
                obj.consumer.close();
              });
            consumers = consumers.filter((obj) => obj.socketId !== socketId);
            transports
              .filter((obj) => obj.socketId === socketId)
              .forEach((obj) => {
                obj.transport.close();
              });
            transports = transports.filter((obj) => obj.socketId !== socketId);

            namespaces[namespace].emit("producer-remove", {
              socketId,
            });
            namespaces[namespace].sockets.get(socketId).disconnect();
            console.log(socketId, "booted");
          });

          nsSocket.on("pause", () => {
            producers
              .filter((obj) => obj.socketId === nsSocket.id)
              .forEach((obj) => {
                obj.producer.pause();
              });
          });

          nsSocket.on("resume", () => {
            producers
              .filter((obj) => obj.socketId === nsSocket.id)
              .forEach((obj) => {
                obj.producer.resume();
              });
          });

          nsSocket.on("createRoom", async (roomName, callback) => {
            if (rooms[roomName] === undefined) {
              // worker.createRouter(options)
              // options = { mediaCodecs, appData }
              // mediaCodecs -> defined above
              // appData -> custom application data - we are not supplying any
              // none of the two are required
              rooms[roomName] = await worker.createRouter({
                mediaCodecs,
              });
              rooms[roomName].admin = nsSocket.id;
              // Create an AudioLevelObserver on the router
              rooms[roomName].audioLevelObserver = await rooms[
                roomName
              ].createAudioLevelObserver({
                maxEntries: 1, // Number of participants to detect as active speakers
                threshold: -60, // Volume threshold in dB, above this is considered speech
                interval: 800, // Interval in ms to calculate the audio levels
              });
              // Listen for active speaker changes
              rooms[roomName].audioLevelObserver.on("volumes", (volumes) => {
                const { producer, volume } = volumes[0]; // Get the most active speaker's producer
                // console.log(
                //   `Active speaker: ${producer.id}, volume: ${volume}`
                // );
                // Send active speaker info to all clients
                namespaces[namespace].emit("activeSpeaker", {
                  producerId: producer.id,
                });
              });

              // Optional: listen for when no one is speaking
              rooms[roomName].audioLevelObserver.on("silence", () => {
                // console.log("No active speakers");
                namespaces[namespace].emit("activeSpeaker", {
                  producerId: null,
                });
              });
              console.log(`Router ID: ${rooms[roomName].id}`);
            }

            getRtpCapabilities(roomName, callback);
          });

          const getRtpCapabilities = (roomName, callback) => {
            const rtpCapabilities = rooms[roomName].rtpCapabilities;
            const isAdmin = nsSocket.id === rooms[roomName].admin;

            callback({ rtpCapabilities, isAdmin });
          };

          nsSocket.on(
            "createWebRtcTransport",
            async ({ sender, roomName }, callback) => {
              console.log(`Is this a sender request? ${sender}`);
              // The client indicates if it is a producer or a consumer
              // if sender is true, indicates a producer else a consumer
              const transportIndex = transports.findIndex(
                (obj) => obj.sender === sender && obj.socketId === nsSocket.id
              );
              console.log("matching transport found at ", transportIndex);
              if (transportIndex === -1) {
                const newTransport = {
                  socketId: nsSocket.id,
                  sender,
                  transport: await createWebRtcTransport(roomName, callback),
                };
                transports = [...transports, newTransport];
                console.log("-new transport created");
              } else {
                console.log("using transport", transportIndex);
                const t = transports[transportIndex];
                callback({
                  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
                  params: {
                    id: t.transport.id,
                    iceParameters: t.transport.iceParameters,
                    iceCandidates: t.transport.iceCandidates,
                    dtlsParameters: t.transport.dtlsParameters,
                  },
                });
              }
            }
          );

          nsSocket.on("transport-connect", async ({ dtlsParameters }) => {
            console.log("DTLS PARAMS... ", { dtlsParameters });
            await transports[
              transports.findIndex(
                (obj) => obj.sender && obj.socketId === nsSocket.id
              )
            ].transport.connect({ dtlsParameters });
          });

          nsSocket.on(
            "transport-produce",
            async ({ kind, rtpParameters, appData, roomName }, callback) => {
              // call produce based on the prameters from the client
              let producer = await transports[
                transports.findIndex(
                  (obj) => obj.sender && obj.socketId === nsSocket.id
                )
              ].transport.produce({
                kind,
                rtpParameters,
                appData,
              });

              console.log("Producer ID: ", producer.id, producer.kind);
              if (producer.kind === "audio") {
                rooms[roomName].audioLevelObserver.addProducer({
                  producerId: producer.id,
                });
              }
              nsSocket.broadcast.emit("producer-add", {
                id: producer.id,
                kind: producer.kind,
              });

              producer.on("transportclose", () => {
                console.log("transport for this producer closed ");
                producer.close();
              });

              producers = [
                ...producers,
                { roomName, socketId: nsSocket.id, producer },
              ];

              // Send back to the client the Producer's id
              callback({
                id: producer.id,
              });
            }
          );
          nsSocket.on("transport-recv-connect", async ({ dtlsParameters }) => {
            console.log(`DTLS PARAMS: ${dtlsParameters}`);
            const i = transports.findIndex(
              (obj) => obj.socketId === nsSocket.id && !obj.sender
            );
            if (!transports[i].transport.appData.connected) {
              console.log("first time connection");
              transports[i].transport.appData.connected = true;
              await transports[i].transport.connect({ dtlsParameters });
            }
          });

          nsSocket.on("getProducers", (roomName, callback) => {
            let currentProducers = [];
            console.log(producers.length, "producers");
            producers.forEach((producer) => {
              if (producer.roomName === roomName) {
                currentProducers = [
                  ...currentProducers,
                  { id: producer.producer.id, kind: producer.producer.kind },
                ];
              }
            });
            callback(currentProducers);
          });

          nsSocket.on(
            "consume",
            async ({ rtpCapabilities, producerId, roomName }, callback) => {
              try {
                // check if the router can consume the specified producer
                if (
                  rooms[roomName].canConsume({
                    producerId: producerId,
                    rtpCapabilities,
                  })
                ) {
                  const i = transports.findIndex(
                    (obj) => obj.socketId === nsSocket.id && !obj.sender
                  );
                  // transport can now consume and return a consumer
                  const consumer = await transports[i].transport.consume({
                    producerId: producerId,
                    rtpCapabilities,
                    paused: true,
                  });

                  consumer.on("transportclose", () => {
                    console.log("transport close from consumer");
                  });

                  consumer.on("producerclose", () => {
                    console.log("producer of consumer closed");
                  });

                  // from the consumer extract the following params
                  // to send back to the Client
                  const params = {
                    id: consumer.id,
                    producerId: producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                    appData:
                      producers[
                        producers.findIndex((p) => p.producer.id === producerId)
                      ].producer.appData.mediaTag,
                    socketId:
                      producers[
                        producers.findIndex((p) => p.producer.id === producerId)
                      ].socketId,
                  };
                  consumers = [
                    ...consumers,
                    { consumer, socketId: nsSocket.id, producerId },
                  ];
                  // send the parameters to the client
                  callback({ params });
                }
              } catch (error) {
                console.log(error.message, error.stack);
                callback({
                  params: {
                    error: error,
                  },
                });
              }
            }
          );

          nsSocket.on("consumer-resume", async ({ producerId }) => {
            console.log("consumer resume ", producerId);
            await consumers[
              consumers.findIndex(
                (obj) =>
                  obj.socketId === nsSocket.id && obj.producerId === producerId
              )
            ].consumer.resume();
          });

          nsSocket.on("disconnect", () => {
            console.log(`User disconnected from namespace: ${namespace}`);
            namespaces[namespace].count = namespaces[namespace].count - 1;
            if (namespaces[namespace].count === 0) {
              console.log("No users in the namespace");
              delete namespaces[namespace];
              delete rooms[namespace];
            }
            // remove the transport associated with the socket
            transports = transports.filter(
              (obj) => obj.socketId !== nsSocket.id
            );

            // remove the producer associated with the socket
            producers = producers.filter((obj) => obj.socketId !== nsSocket.id);

            // remove the consumer associated with the socket
            consumers = consumers.filter((obj) => obj.socketId !== nsSocket.id);

            nsSocket.broadcast.emit("producer-remove", {
              socketId: nsSocket.id,
            });
          });
        });
      }

      // Join the user to the namespace
      socket.emit("namespaceJoined", namespace);
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on https://${hostname}:${port}`);
    });
});
