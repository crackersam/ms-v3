import React, { useEffect, useRef } from "react";
import { Fullscreen, Minimize, Ban } from "lucide-react";

const Consumer = ({ consumer, audioConsumer, myId, socket, admin }) => {
  const videoRef = useRef();
  const runOnce = useRef(false);
  const [fullScreen, setFullScreen] = React.useState(false);
  const videoPlayer = useRef();
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
            videoRef.current.style.border = "5px solid #0000ff";
          } else {
            videoRef.current.style.border = "none";
          }
        }
      });
    }
  }, [audioConsumer]);
  return consumer ? (
    <div
      ref={videoPlayer}
      className="flex relative w-[180px] h-[180px] flex-col justify-center bg-black align-middle rounded-md m-2 border-slate-400 border-[3px]"
    >
      <video
        ref={videoRef}
        className="max-h-[100%] max-w-[100%]"
        autoPlay
        playsInline
      />
      {admin.current && (
        <Ban
          className="absolute bottom-1 right-10 m-2 cursor-pointer"
          onClick={() => {
            socket.emit("boot", consumer.socketId);
          }}
        />
      )}
      <Fullscreen
        className="absolute bottom-1 right-1 m-2 cursor-pointer"
        onClick={() => {
          videoPlayer.current.requestFullscreen();
          setFullScreen(true);
        }}
      />
      {fullScreen && (
        <Minimize
          className="absolute bottom-1 right-1 m-2 cursor-pointer"
          onClick={() => {
            document.exitFullscreen();
            setFullScreen(false);
          }}
        />
      )}
    </div>
  ) : null;
};

export default Consumer;
