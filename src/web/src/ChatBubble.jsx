import React, { useState, useEffect } from "react";

import { ChatsSVG } from "./icons.jsx";

const ChatBubble = ({ storyIndex, commentCount }) => {
  commentCount = parseInt(commentCount, 10);
  return (
    <a
      onClick={() =>
        window.dispatchEvent(new CustomEvent(`open-comments-${storyIndex}`))
      }
      href={null}
      className="chat-bubble interaction-element"
      id={`chat-bubble-${storyIndex}`}
      style={{
        margin: "5px",
        backgroundColor: "#e6e6df",
        borderRadius: "2px",
        display: "flex",
        alignSelf: "stretch",
        justifyContent: "center",
        minWidth: "40px",
        alignItems: "center",
        flexDirection: "column",
      }}
    >
      <ChatsSVG />
      <span style={{ color: "rgba(0,0,0,0.65)", fontSize: "8pt" }}>
        {commentCount !== 0 ? commentCount : null}
      </span>
    </a>
  );
};

export default ChatBubble;
