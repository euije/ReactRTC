import { addDoc, collection, doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react'

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

const registerPeerConnectionListeners = (peerConnectionRef) => {
  const peerConnection = peerConnectionRef.current;
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
      `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
      `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });
}

const callerIceCandidate = (db, peerConnectionRef, roomId) => {
  const peerConnection = peerConnectionRef.current;
  const callerCandidatesCollection = collection(db, "myRooms", roomId, "callerCandidates");

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    addDoc(callerCandidatesCollection, event.candidate.toJSON());
  });
}

const createOffer = async (db, peerConnectionRef, roomId) => {
  const peerConnection = peerConnectionRef.current;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };

  const roomRef = doc(db, "myRooms", roomId);
  setDoc(roomRef, roomWithOffer)
}

const addCalleeIceCandidateListener = (db, peerConnectionRef, roomId) => {
  const peerConnection = peerConnectionRef.current;
  const roomRef = doc(db, "myRooms", roomId);
  const calleeRef = collection(db, "myRooms", roomId, "calleeCandidates");

  onSnapshot(roomRef, (async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  }));
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  onSnapshot(calleeRef, snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
}

const createRoom = (db, peerConnectionRef, roomId) => {
  callerIceCandidate(db, peerConnectionRef, roomId);
  createOffer(db, peerConnectionRef, roomId);

  addCalleeIceCandidateListener(db, peerConnectionRef, roomId);
};

/* ------------------------------------------------------------------------------------ */

const calleeIceCandidate = (db, peerConnectionRef, roomId) => {
  const peerConnection = peerConnectionRef.current;
  const calleeCandidatesCollection = collection(db, "myRooms", roomId, "calleeCandidates");

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    addDoc(calleeCandidatesCollection, event.candidate.toJSON());
  });
}

const createAnswer = async (db, peerConnectionRef, roomId) => {
  const peerConnection = peerConnectionRef.current;
  const roomRef = doc(db, "myRooms", roomId);
  const roomDoc = await getDoc(roomRef);
  const callerRef = collection(db, "myRooms", roomId, "callerCandidates");

  const { offer } = roomDoc.data();
  console.log('Got offer:', offer);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peerConnection.createAnswer();
  console.log('Created answer:', answer);
  await peerConnection.setLocalDescription(answer);

  const roomWithAnswer = {
    answer: {
      type: answer.type,
      sdp: answer.sdp,
    },
  };
  await updateDoc(roomRef, roomWithAnswer);

  onSnapshot(callerRef, snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

const joinRoom = (db, peerConnectionRef, roomId) => {
  calleeIceCandidate(db, peerConnectionRef, roomId);
  createAnswer(db, peerConnectionRef, roomId);
};

const RTCContainer = ({
  db
}) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(new MediaStream());
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const peerConnectionRef = useRef();
  const [roomId, setRoomId] = useState(null);
  const [who, setWho] = useState("");

  const dataChannelRef = useRef();
  const [inputText, setInputText] = useState("");
  const [messageList, setMessageList] = useState([]);

  const [uploadFile, setUploadFile] = useState(null);
  const [uploadBuffer, setUploadBuffer] = useState([]);
  const [expectedSize, setExpectedSize] = useState(0);
  const [expectedName, setExpectedName] = useState("");
  const [receivedBuffer, setReceivedBuffer] = useState([]);
  const [receivedSize, setReceivedSize] = useState(0);

  const handleCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localStreamRef.current.srcObject = stream;
    setLocalStream(stream);
    console.log(localStreamRef);

    remoteStreamRef.current.srcObject = remoteStream;

    stream.getTracks().forEach(track => {
      peerConnectionRef.current.addTrack(track, stream);
    });
  }

  useEffect(() => {
    if (!peerConnectionRef.current) {
      peerConnectionRef.current = new RTCPeerConnection(configuration);
      console.log('Create PeerConnectionRef with configuration: ', configuration);

      registerPeerConnectionListeners(peerConnectionRef);

      peerConnectionRef.current.addEventListener('track', event => {
        const tempStream = remoteStream.clone();

        console.log('Got remote track:', event.streams[0]);
        event.streams[0].getTracks().forEach(track => {
          console.log('Add a track to the remoteStream:', track);
          tempStream.addTrack(track);
        });

        setRemoteStream(tempStream)
      });

      peerConnectionRef.current.addEventListener('datachannel', (event) => {
        const remoteDataChannel = event.channel;
        remoteDataChannel.addEventListener('message', (event) => {
          try {
            const dataMessage = JSON.parse(event.data);
            const { type } = dataMessage;

            if (type === "file") {
              const { name, size } = dataMessage;
              setExpectedName((prev) => name);
              setExpectedSize((prev) => size);
            } else if (type === "text") {
              const { sender, message, timestamp } = dataMessage;
              setMessageList((prev) => [...prev, { sender, message, timestamp }]);
            }
          } catch (e) {
            remoteDataChannel.binaryType = 'arraybuffer';

            setReceivedBuffer(prev => [...prev, event.data]);
            setReceivedSize(prev => prev += event.data.byteLength);
          }
        });
      });

      dataChannelRef.current = peerConnectionRef.current.createDataChannel("chat", { ordered: true });
    }
  }, []);

  useEffect(() => {
    if (remoteStream) {
      remoteStreamRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (uploadFile instanceof File) {
      dataChannelRef.current.send(JSON.stringify({ type: "file", name: uploadFile.name, size: uploadFile.size }));
    }
  }, [uploadFile]);

  // useEffect(() => {
  //   if(uploadFile && uploadFile.size === uploadBuffer.length) {
  //     setMessageList(prev => [...prev, {
  //       sender: who,
  //       href: URL.createObjectURL(new Blob(uploadBuffer)),
  //       name: uploadFile.name,
  //       timestamp: new Date().toLocaleString('ko-kr', { timeZone: 'UTC' })
  //     }]);
  //   }
  // }, [uploadBuffer]);

  useEffect(() => {
    if (receivedSize === expectedSize && receivedSize && expectedSize) {
      const received = new Blob(receivedBuffer);
      setReceivedBuffer([]);
      setReceivedSize(0);

      setMessageList((prev) => [...prev, {
        href: URL.createObjectURL(received),
        name: expectedName,
        timestamp: new Date().toLocaleString('ko-kr', { timeZone: 'UTC' })
      }]);
      console.log({
        href: URL.createObjectURL(received),
        name: expectedName,
        timestamp: new Date().toLocaleString('ko-kr', { timeZone: 'UTC' })
      });

      console.log("file is loaded!");
    }
  }, [expectedSize, expectedName, receivedBuffer, receivedSize]);

  return (
    <>
      <div style={{ display: "flex" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "500px", height: "800px", justifyContent: "space-evenly" }}>
          <div style={{ border: "10px solid blue" }}>
            <video ref={localStreamRef} muted autoPlay playsInline></video>
          </div>
          <div style={{ border: "10px solid green" }}>
            <video ref={remoteStreamRef} muted autoPlay playsInline></video>
          </div>
          <button
            disabled={localStream}
            onClick={handleCamera}>{"카메라, 마이크 켜기"}</button>

          <div>
            <input
              placeholder='방 이름을 입력하세요'
              onChange={(e) => setRoomId(e.target.value)} />
            <button
              disabled={who === "" ? false : who !== "caller"}
              onClick={() => {
                createRoom(db, peerConnectionRef, roomId);
                setWho("caller");
              }}>{"방 만들기"}</button>
            <button
              disabled={who === "" ? false : who !== "callee"}
              onClick={() => {
                joinRoom(db, peerConnectionRef, roomId);
                setWho("callee");
              }}>{"방 참여하기"}</button>
          </div>

          <div>{`Current room is ${roomId} - You are the ${who}!`}</div>
          <button onClick={() => console.log(peerConnectionRef.current)}>{"RTCPeerConnection 객체 보기"}</button>
          <button onClick={() => console.log(dataChannelRef.current)}>{"RTCDataChannel 객체 보기"}</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: "500px", height: "800px", justifyContent: "space-evenly", alignItems: "center" }}>
          <div style={{ width: "300px", height: "700px", overflowY: "scroll", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {
              messageList.map((message, index) => {
                if (message.href) {
                  return (
                    <div key={index} style={{
                      width: "200px",
                      height: "50px",
                      borderRadius: "10px",
                      backgroundColor: who === message.sender ? "green" : "blue",
                      margin: `5px ${who !== message.sender ? "auto" : 0} 5px ${who === message.sender ? "auto" : 0}`,
                      color: "white"
                    }}>
                      <a style={{color: "orange"}} href={message.href} download={message.name}>
                        {`${message.name}`}
                      </a>
                      <div>
                        {message.timestamp}
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div key={index} style={{
                      width: "200px",
                      height: "50px",
                      borderRadius: "10px",
                      backgroundColor: who === message.sender ? "green" : "blue",
                      margin: `5px ${who !== message.sender ? "auto" : 0} 5px ${who === message.sender ? "auto" : 0}`,
                      color: "white"
                    }}>
                      <div>
                        {message.message}
                      </div>
                      <div>
                        {message.timestamp}
                      </div>
                    </div>
                  );
                }
              })
            }
          </div>
          <div>
            <input
              value={inputText}
              onChange={(e) => { setInputText(e.target.value) }}
              placeholder='채팅'
            />
            <button
              disabled={who === ""}
              onClick={() => {
                const message = {
                  type: "text",
                  sender: who,
                  message: inputText,
                  timestamp: new Date().toLocaleString('ko-kr', { timeZone: 'UTC' })
                };
                dataChannelRef.current.send(JSON.stringify(message));
                setMessageList(prev => [...prev, message]);
              }}
            >{"전송"}</button>
            <div>
              <input type="file" name="files" onChange={(event) => {
                setUploadFile(event.target.files[0]);
              }} />
              <button onClick={() => {
                let offset = 0;
                const chunkSize = 16384;

                const readSlice = (fileReader, file, o, offset, chunkSize) => {
                  const slice = file.slice(offset, o + chunkSize);
                  fileReader.readAsArrayBuffer(slice);
                };

                const fileReader = new FileReader();
                fileReader.addEventListener('load', (event) => {
                  dataChannelRef.current.send(event.target.result);
                  setUploadBuffer((prev) => [...prev, event.target.result]);

                  offset += event.target.result.byteLength;

                  if (offset < uploadFile.size) {
                    readSlice(fileReader, uploadFile, offset, offset, chunkSize);
                  }
                })

                readSlice(fileReader, uploadFile, 0, offset, chunkSize);

                setMessageList(prev => [...prev, {
                  sender: who,
                  href: URL.createObjectURL(uploadFile),
                  name: uploadFile.name,
                  timestamp: new Date().toLocaleString('ko-kr', { timeZone: 'UTC' })
                }]);
              }}>{"파일 전송하기"}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default RTCContainer