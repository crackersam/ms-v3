import React, { useEffect, useRef } from "react";
import {
  Fullscreen,
  Minimize,
  Ban,
  CirclePause,
  CirclePlay,
} from "lucide-react";

const Consumer = ({ consumer, audioConsumer, myId, socket, admin }) => {
  const videoRef = useRef();
  const runOnce = useRef(false);
  const [fullScreen, setFullScreen] = React.useState(false);
  const videoPlayer = useRef();
  const videoCase = useRef();
  const [paused, setPaused] = React.useState(false);
  useEffect(() => {
    if (runOnce.current) return;
    const { track } = consumer.consumer;

    videoRef.current.srcObject = new MediaStream([track]);

    socket.emit("consumer-resume", {
      producerId: consumer.producerId,
    });
    runOnce.current = true;
  }, []);
  useEffect(() => {
    if (audioConsumer) {
      if (
        myId.current === audioConsumer.producerId ||
        myId.current === consumer.producerId
      ) {
        videoRef.current.muted = true;
      }
      const { track } = audioConsumer.consumer;
      videoRef.current.srcObject.addTrack(track);
      socket.emit("consumer-resume", {
        producerId: audioConsumer.producerId,
      });
      socket.on("activeSpeaker", (data) => {
        const activeSpeakerId = data.producerId;
        // Highlight or enlarge the video feed of the active speaker
        if (videoRef.current) {
          if (activeSpeakerId === audioConsumer.producerId) {
            videoCase.current.style.border = "5px solid #0000ff";
          } else {
            videoCase.current.style.border = "none";
          }
        }
      });
    }
  }, [audioConsumer]);
  return consumer ? (
    <div
      ref={videoPlayer}
      className="flex relative flex-col justify-center bg-black align-middle rounded-md m-2 border-slate-400 border-[3px]"
    >
      <div
        ref={videoCase}
        className="flex flex-col overflow-x-hidden justify-center w-[180px] h-[180px]"
      >
        <video
          ref={videoRef}
          className="max-h-[85%] max-w-[100%]"
          autoPlay
          playsInline
        />
        <p className="text-white text-center">{consumer.appData.name}</p>
        {admin.current && consumer.appData.mediaTag !== "local" && (
          <Ban
            className="absolute top-1 right-1 m-2 cursor-pointer bg-black rounded-full text-white"
            onClick={() => {
              socket.emit("boot", consumer.socketId);
            }}
          />
        )}
        <Fullscreen
          className="absolute bottom-1 right-1 m-2 cursor-pointer bg-black rounded-md text-white"
          onClick={() => {
            videoCase.current.requestFullscreen();
            setFullScreen(true);
          }}
        />
        {fullScreen && (
          <Minimize
            className="absolute bottom-1 right-1 m-2 cursor-pointer bg-black rounded-md text-white"
            onClick={() => {
              document.exitFullscreen();
              setFullScreen(false);
            }}
          />
        )}
        {consumer.socketId === socket.id && !paused && (
          <CirclePause
            className="absolute bottom-1 left-1 m-2 cursor-pointer bg-black rounded-full text-white"
            onClick={() => {
              socket.emit("pause");
              setPaused(true);
            }}
          />
        )}
        {consumer.socketId === socket.id && paused && (
          <CirclePlay
            className="absolute bottom-1 left-1 m-2 cursor-pointer bg-black rounded-full text-white"
            onClick={() => {
              socket.emit("resume");
              setPaused(false);
            }}
          />
        )}
      </div>
    </div>
  ) : null;
};

export default Consumer;
