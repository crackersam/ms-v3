"use client";
import React, { useEffect } from "react";
import { socket } from "@/socket";
import Link from "next/link";

const Home = () => {
  const [namespaces, setNamespaces] = React.useState([]);

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
    <div>
      Rooms:{" "}
      <ul>
        {namespaces.map((room, index) => (
          // Added a unique key for each room
          <li key={index}>
            <Link href={`/room/${room}`}>{room}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Home;
