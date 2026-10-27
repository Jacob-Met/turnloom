export function demoSeed(id) {
  return {
    id, title: 'A place for our reading circle', fictional:true,
    participants: [
      {id:'mira', name:'Mira'},
      {id:'leo', name:'Leo'},
      {id:'sam', name:'Sam'},
      {id:'jo', name:'Jo'},
    ],
    topics: [
      {id:'place',label:'Where we meet'},
      {id:'timing',label:'When we meet'},
      {id:'books',label:'What we read'},
    ],
    activeTopicId:'place',
    anchors: [
      {id:'a1',statement:'Could our reading circle meet in the library garden?',speakerId:'leo',topicId:'place',source:'manual'},
      {id:'a2',statement:'I like the quiet there. Is the path from the entrance step-free?',speakerId:'jo',topicId:'place',source:'manual'},
      {id:'a3',statement:'The front path is level, but the garden gate is sometimes locked.',speakerId:'sam',topicId:'place',source:'manual'},
      {id:'a4',statement:'We could ask the librarian to keep that gate open for our meeting.',speakerId:'leo',topicId:'place',source:'manual'},
      {id:'a5',statement:'I would like a place with a table where all of us can sit together.',speakerId:'mira',topicId:'place',source:'manual'},
      {id:'a6',statement:'Let us keep both the gate and the table in mind before choosing.',speakerId:'jo',topicId:'place',source:'manual'},
    ],
  };
}
