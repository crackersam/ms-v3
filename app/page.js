"use client";
import React, { useEffect } from "react";
import { socket } from "@/socket";
import Link from "next/link";
import { useRouter } from "next/navigation";

const Home = () => {
  const [namespaces, setNamespaces] = React.useState([]);
  const newRoomName = React.useRef("");
  const router = useRouter();

  useEffect(() => {
    // Listen for the "list-namespaces" event
    const handleNamespaces = (data) => {
      setNamespaces(data);
    };
    socket.emit("list-namespaces");
    socket.on("namespaces", handleNamespaces);

    // Clean up the listener when the component unmounts
    return () => {
      socket.off("namespaces", handleNamespaces);
    };
  }, []);

  return (
    <div className="w-screen h-screen p-5">
      <p className="text-xl">Active rooms:</p>
      <ul>
        {namespaces.length > 0 ? (
          namespaces.map((room, index) => (
            <li key={index}>
              <Link
                className="text-yellow-500 underline"
                href={`/room/${room}`}
              >
                {room}
              </Link>
            </li>
          ))
        ) : (
          <li>No rooms available</li>
        )}
      </ul>
      <hr className="" />
      <p className="pb-4 pt-4 text-xl">Create a new room:</p>
      <form>
        <input
          ref={newRoomName}
          type="text"
          className="rounded-full px-5 py-2 text-xl text-black"
        />
        <button
          type="submit"
          className="bg-blue-500 text-white text-xl rounded-full px-5 py-2"
          onClick={(e) => {
            e.preventDefault();
            router.push(`/room/${newRoomName.current.value}`);
          }}
        >
          Go!
        </button>
      </form>
    </div>
  );
};

export default Home;
