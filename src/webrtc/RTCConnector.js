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
    if(!peerConnectionRef.current){
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
    }
  }, []);

  useEffect(() => {
    if(remoteStream && remoteStream instanceof MediaStream) {
      remoteStreamRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <>
      <button onClick={handleCamera}>{"카메라, 마이크 켜기"}</button>
      <video ref={localStreamRef} muted autoPlay playsInline></video>
      <video ref={remoteStreamRef} muted autoPlay playsInline></video>

      <div style={{ display: "flex", flexDirection: "column", height: "150px", justifyContent: "space-evenly" }}>
        <input onChange={(e) => setRoomId(e.target.value)} />
        <button onClick={() => {
          createRoom(db, peerConnectionRef, roomId);
          setWho("caller");
        }}>{"방 만들기"}</button>
        <button onClick={() => {
          joinRoom(db, peerConnectionRef, roomId);
          setWho("callee");
        }}>{"방 참여하기"}</button>

        <div>{`Current room is ${roomId} - You are the ${who}!`}</div>
        <button onClick={() => console.log(peerConnectionRef.current)}>{"RTCConnection 객체 보기"}</button>
      </div>
    </>
  )
}

export default RTCContainer