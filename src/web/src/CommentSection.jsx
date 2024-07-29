import React, { useState, useEffect } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import Linkify from "linkify-react";

import CommentInput from "./CommentInput.jsx";
import { fetchStory } from "./API.mjs";

function truncateName(name) {
  const maxLength = 12;
  if (
    !name ||
    (name && name.length <= maxLength) ||
    (name && name.length === 0)
  )
    return name;
  return name.slice(0, maxLength) + "...";
}

const Comment = ({ comment, index }) => {
  return (
    <span
      style={{
        color: "black",
        border: "1px solid rgba(0,0,0,0.1)",
        backgroundColor: "#E6E6DF",
        padding: "0.55rem 0.75rem",
        borderRadius: "2px",
        display: "block",
        marginBottom: "15px",
        whiteSpace: "pre-wrap",
        lineHeight: "1.3",
        wordBreak: "break-word",
        overflowWrap: "break-word",
      }}
    >
      <div
        style={{
          whiteSpace: "nowrap",
          gap: "3px",
          marginBottom: "0.25rem",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {comment.identity.safeAvatar && (
          <img
            loading="lazy"
            src={comment.identity.safeAvatar}
            alt="avatar"
            style={{
              marginRight: "5px",
              width: "12px",
              height: "12px",
              border: "1px solid #828282",
              borderRadius: "2px",
            }}
          />
        )}
        <b>{truncateName(comment.identity.displayName)}</b>
        <span> • </span>
        <span style={{ color: "grey" }}>
          {formatDistanceToNowStrict(new Date(comment.timestamp * 1000))}
          <span> ago</span>
        </span>
      </div>
      <br />
      <span>
        <Linkify
          options={{
            className: "meta-link",
            target: "_blank",
            defaultProtocol: "https",
            validate: {
              url: (value) => /^https:\/\/.*/.test(value),
              email: () => false,
            },
          }}
        >
          {comment.title}
        </Linkify>
      </span>
    </span>
  );
};

const CommentsSection = (props) => {
  const { storyIndex, commentCount } = props;
  const [comments, setComments] = useState([]);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const toggle = () => {
      setShown(!shown);
    };
    window.addEventListener(`open-comments-${storyIndex}`, toggle);
    return () =>
      window.removeEventListener(`open-comments-${storyIndex}`, toggle);
  }, [shown]);

  useEffect(() => {
    (async () => {
      if (commentCount === 0) return;

      const story = await fetchStory(storyIndex);
      if (story && story.comments) setComments(story.comments);
    })();
  }, [storyIndex]);

  if (!shown) return;
  return (
    <div style={{ padding: "5px 5px 0 5px", fontSize: "1rem" }}>
      {comments.length > 0 &&
        comments.map((comment) => (
          <Comment key={comment.index} comment={comment} index={storyIndex} />
        ))}
      <CommentInput {...props} style={{ margin: "1rem 0" }} />
    </div>
  );
};

export default CommentsSection;
