"use client";
import React, { useEffect, useRef } from "react";
import { socket } from "@/socket";
import { io } from "socket.io-client";
import * as mediasoup from "mediasoup-client";
import ActiveSpeaker from "./ActiveSpeaker";
import Consumer from "./Consumer";
import { Fullscreen, Minimize, Hand } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

const RoomNamed = ({ params: { roomName } }) => {
  const nsSocket = useRef(null);
  const runOnce = useRef(false);
  const params = React.useRef({
    // mediasoup params:
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S3T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });
  const audioParams = React.useRef({});
  const device = React.useRef(null);
  const rtpCapabilities = React.useRef(null);
  const producerTransport = React.useRef(null);
  const producer = React.useRef(null);
  const audioProducer = React.useRef(null);
  const myId = React.useRef(null);
  const consumerTransport = React.useRef(null);
  const [consumers, setConsumers] = React.useState([]);
  const [audioConsumers, setAudioConsumers] = React.useState([]);
  const fullscreen = React.useRef(null);
  const [button, setButton] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const isProducer = React.useRef(false);
  const isConsuming = React.useRef(false);
  const speakerIndex = React.useRef(0);
  const runOnce2 = useRef(false);
  const isAdmin = React.useRef(false);
  const [name, setName] = React.useState(null);
  const hand = React.useRef(null);
  const handRaise = React.useRef(null);
  const [handRaised, setHandRaised] = React.useState(false);
  useEffect(() => {
    if (runOnce.current) return;
    socket.emit("joinNamespace", roomName);
    socket.on("namespaceJoined", (namespace) => {
      nsSocket.current = io(`/${namespace}`);
      nsSocket.current.on("connection-success", ({ data, nsSocketId }) => {
        console.log(data, nsSocketId);
      });
      console.log(`Joined namespace: ${namespace}`);
    });
    hand.current.style.zIndex = speakerIndex.current + 1;
    runOnce.current = true;
  }, []);

  useEffect(() => {
    if (runOnce2.current) return;
    if (!nsSocket.current) return;
    nsSocket.current.on("disconnect", (reason) => {
      console.log("Disconnected from the server. Reason:", reason);

      // Optionally, take action based on the reason
      if (reason === "io server disconnect") {
        const newConsumers = [...consumers];
        newConsumers.forEach((consumer) => {
          consumer.consumer.close();
          consumer = null;
        });
        setConsumers(newConsumers);
        // The server forcibly disconnected this client
        alert("You were kicked or disconnected by the server.");
      } else if (reason === "ping timeout") {
        console.log("Connection lost due to ping timeout.");
      } else if (reason === "transport close") {
        console.log("Transport closed unexpectedly.");
      } else {
        console.log("Disconnected due to network issues.");
      }
    });
    nsSocket.current.on("handRaised", ({ name }) => {
      if (handRaised) return;
      setHandRaised(name);
      handRaise.current.style.display = "block";
      handRaise.current.style.zIndex = speakerIndex.current + 1;
      setTimeout(() => {
        handRaise.current.style.display = "none";
        setHandRaised("");
      }, 10000);
    });
    nsSocket.current.on("producer-add", ({ id, kind }) => {
      console.log(`Producer added: ${id}, ${kind}`);
      if (isConsuming.current) {
        connectRecvTransport(id);
      }
    });
    nsSocket.current.on("joinApproval", () => {
      getLocalStream();
    });

    nsSocket.current.on("joinResponse", ({ response }) => {
      if (response) {
        getLocalStream();
      } else {
        alert("Your request to join the room was denied.");
      }
    });
    nsSocket.current.on("joinRequest", ({ name, socketId }) => {
      let response = window.confirm(`${name} wants to join the room`);
      if (response) {
        nsSocket.current.emit("joinApproval", { socketId });
      } else {
        nsSocket.current.emit("joinRejection", { socketId });
      }
    });
    nsSocket.current.on("joinRejected", () => {
      alert("Your request to join the room was denied.");
    });
    nsSocket.current.on("joinApproved", () => {
      console.log("Join approved");
      getLocalStream();
    });
    const publishId = uuidv4();
    params.current.appData = { ...params.current, mediaTag: publishId };
    audioParams.current.appData = {
      ...audioParams.current,
      mediaTag: publishId,
    };
    nsSocket.current.on("producer-remove", ({ socketId }) => {
      setConsumers((prevConsumers) => {
        const newConsumers = [...prevConsumers];
        const index = newConsumers.findIndex(
          (consumer) => consumer?.socketId === socketId
        );
        if (index !== -1) {
          newConsumers[index].consumer.close();
          newConsumers[index] = null;
        }
        return newConsumers;
      });
      setAudioConsumers((prevConsumers) => {
        const newConsumers = [...prevConsumers];
        const index = newConsumers.findIndex(
          (consumer) => consumer?.socketId === socketId
        );
        if (index !== -1) {
          newConsumers[index].consumer.close();
          newConsumers[index] = null;
        }
        return newConsumers;
      });
    });

    runOnce2.current = true;
  }, [nsSocket.current]);

  useEffect(() => {
    if (name) {
      params.current.appData.name = name;
      nsSocket.current.emit("joinRequest", { name, roomName });
    }
  }, [name]);

  const getName = () => {
    setButton(true);
    setName(prompt("Enter your name"));
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const track = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        setConsumers([
          { consumer: { track }, appData: { mediaTag: "local", name: name } },
        ]);
        setAudioConsumers([
          {
            consumer: { track: audioTrack },
            appData: { mediaTag: "local", name: name },
          },
        ]);
        audioParams.current.track = audioTrack;
        params.current.track = track;
        hand.current.style.display = "block";
        goConnect(true);
      })
      .catch((err) => {
        console.error(err);
      });
  };
  const goConsume = () => {
    if (isConsuming.current) return;
    createRecvTransport();
    goConnect(false);
    isConsuming.current = true;
  };

  const goConnect = (producerOrConsumer) => {
    isProducer.current = producerOrConsumer;
    !device.current ? getRtpCapabilities() : goCreateTransport();
  };

  const goCreateTransport = () => {
    isProducer.current ? createSendTransport() : getProducers();
  };

  const getProducers = () => {
    nsSocket.current.emit("getProducers", roomName, (data) => {
      data.forEach((producer) => {
        console.log("connecting recv transport", producer.id);
        connectRecvTransport(producer.id);
      });
    });
  };

  const getRtpCapabilities = async () => {
    nsSocket.current.emit("createRoom", roomName, (data) => {
      console.log(data);
      isAdmin.current = data.isAdmin;
      rtpCapabilities.current = data.rtpCapabilities;
      createDevice();
    });
  };

  const createDevice = async () => {
    device.current = new mediasoup.Device();
    await device.current.load({
      routerRtpCapabilities: rtpCapabilities.current,
    });
    console.log(device.current.rtpCapabilities);
    goCreateTransport();
  };

  const createSendTransport = () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    nsSocket.current.emit(
      "createWebRtcTransport",
      { sender: true, roomName },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport.current = device.current.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.current.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-connect', ...)
              await nsSocket.current.emit("transport-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        producerTransport.current.on(
          "produce",
          async (parameters, callback, errback) => {
            console.log(parameters);

            try {
              // tell the server to create a Producer
              // with the following parameters and produce
              // and expect back a server side producer id
              // see server's socket.on('transport-produce', ...)
              await nsSocket.current.emit(
                "transport-produce",
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                  roomName,
                },
                ({ id }) => {
                  // Tell the transport that parameters were transmitted and provide it with the
                  // server side producer's id.
                  if (parameters.kind === "video") {
                    setConsumers((prevConsumers) => {
                      const newConsumers = [...prevConsumers];
                      newConsumers.find(
                        (obj) => obj.appData.mediaTag === "local"
                      ).producerId = id;
                      return newConsumers;
                    });
                  } else if (parameters.kind === "audio") {
                    setAudioConsumers((prevConsumers) => {
                      const newConsumers = [...prevConsumers];
                      newConsumers.find(
                        (obj) => obj.appData.mediaTag === "local"
                      ).producerId = id;
                      return newConsumers;
                    });
                  }
                  callback({ id });
                }
              );
            } catch (error) {
              errback(error);
            }
          }
        );
        connectSendTransport();
      }
    );
  };
  const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above
    producer.current = await producerTransport.current.produce(params.current);
    audioProducer.current = await producerTransport.current.produce(
      audioParams.current
    );

    audioProducer.current.on("trackended", () => {
      console.log("audio track ended");

      // close audio track
    });

    audioProducer.current.on("transportclose", () => {
      console.log("audio transport ended");

      // close audio track
    });

    producer.current.on("trackended", () => {
      console.log("track ended");

      // close video track
    });

    producer.current.on("transportclose", () => {
      console.log("transport ended");

      // close video track
    });
    goConsume();
  };
  const createRecvTransport = async (producerId) => {
    // see server's socket.on('consume', sender?, ...)
    // this is a call from Consumer, so sender = false
    await nsSocket.current.emit(
      "createWebRtcTransport",
      { sender: false, roomName },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to receive media
        // based on server's consumer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
        consumerTransport.current = device.current.createRecvTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectRecvTransport() below
        consumerTransport.current.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await nsSocket.current.emit("transport-recv-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );
        connectRecvTransport(producerId);
      }
    );
  };
  const connectRecvTransport = async (producerId) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await nsSocket.current.emit(
      "consume",
      {
        rtpCapabilities: device.current.rtpCapabilities,
        producerId,
        roomName,
      },
      async ({ params }) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(params);
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.current.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
          socketId: params.socketId,
        });
        if (params.kind === "video") {
          setConsumers((prevConsumers) => [
            ...prevConsumers,
            {
              consumer,
              producerId,
              socketId: params.socketId,
              appData: params.appData,
            },
          ]);
        } else if (params.kind === "audio") {
          setAudioConsumers((prev) => [
            ...prev,
            {
              consumer,
              producerId,
              socketId: params.socketId,
              appData: params.appData,
            },
          ]);
        }
      }
    );
  };
  return (
    <div ref={fullscreen} className="w-screen h-screen relative">
      {!button && (
        <button
          className="absolute top-0 left-[50%] z-10 translate-x-[-50%] p-2 bg-slate-800 rounded-md text-white"
          onClick={getName}
        >
          Join Room
        </button>
      )}
      <div
        ref={hand}
        className={`absolute top-[40%] right-1 hidden rounded-md bg-black text-white p-2 cursor-pointer`}
        onClick={() => {
          nsSocket.current.emit("raiseHand", { roomName, name });
        }}
      >
        <Hand size={24} strokeWidth={2} />
      </div>
      <div
        ref={handRaise}
        className="absolute top-[25%] left-[66%] hidden rounded-md bg-white text-black p-2"
      >
        {handRaised}&#39;s hand is raised
      </div>
      <div className="absolute top-0 left-[50%] translate-x-[-50%] justify-center align-middle w-screen h-[calc(100vh-200px)]">
        {consumers.map((consumer, i) => {
          // Find the matching audioConsumer based on appData
          const matchingAudio = audioConsumers.find(
            (audio) => audio?.appData.mediaTag === consumer?.appData.mediaTag
          );

          return (
            <ActiveSpeaker
              key={i}
              speakerIndex={speakerIndex}
              consumer={consumer} // Pass the video stream
              audioConsumer={matchingAudio || undefined} // Pass the audio stream only if it exists
              socket={nsSocket.current}
            />
          );
        })}
      </div>
      <div className="flex flex-row absolute bottom-0 overflow-x-auto w-screen">
        {consumers.map((consumer, i) => {
          // Find the matching audioConsumer based on appData
          const matchingAudio = audioConsumers.find(
            (audio) => audio?.appData.mediaTag === consumer?.appData.mediaTag
          );

          return (
            <Consumer
              admin={isAdmin}
              key={i}
              myId={myId}
              consumer={consumer} // Pass the video stream
              audioConsumer={matchingAudio || undefined} // Pass the audio stream only if it exists
              socket={nsSocket.current}
            />
          );
        })}
      </div>
      {device.current && !isFullscreen && (
        <Fullscreen
          className="absolute bottom-1 right-1 p-2 text-white bg-black rounded-md cursor-pointer"
          size={48}
          stroke="white"
          strokeWidth={2}
          onClick={() => {
            fullscreen.current.requestFullscreen();
            setIsFullscreen(true);
          }}
        />
      )}{" "}
      {isFullscreen && (
        <Minimize
          className="absolute bottom-1 bg-black rounded-md right-1 p-2 text-white cursor-pointer"
          size={48}
          stroke="white"
          strokeWidth={2}
          onClick={() => {
            document.exitFullscreen();
            setIsFullscreen(false);
          }}
        />
      )}
    </div>
  );
};

export default RoomNamed;
