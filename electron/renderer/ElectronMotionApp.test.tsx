import React from 'react';

const ElectronMotionAppTest: React.FC = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Motion Capture Test</h1>
      <p>If you can see this, React is working correctly!</p>
      <div>
        <button onClick={() => alert('Button works!')}>Test Button</button>
      </div>
    </div>
  );
};

export default ElectronMotionAppTest;