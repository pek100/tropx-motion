export function AtomSpin({ className = "size-4" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* Layer 1 - Horizontal crescents */}
      <svg
        className="absolute inset-0 m-auto animate-spin-slow"
        style={{ animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)', width: '100%', height: '38%' }}
        viewBox="0 0 29 11" fill="none" xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M3.93254 10.5391C1.50819 9.15251 0.0269748 7.29319 0.0436705 5.25665C0.0605864 3.22046 1.57169 1.38565 4.01781 0.0394892C2.44765 1.49689 1.51022 3.30299 1.49382 5.26773C1.47757 7.2333 2.38559 9.05565 3.93254 10.5391ZM28.5319 5.49333C28.5148 7.53283 26.9984 9.37053 24.5451 10.7172C26.1201 9.25861 27.0595 7.44848 27.0759 5.48025C27.0922 3.51287 26.1838 1.6883 24.6343 0.203928C27.0641 1.59118 28.5489 3.45416 28.5319 5.49333Z" fill="currentColor"/>
      </svg>

      {/* Layer 2 - Vertical outer shell */}
      <svg
        className="absolute inset-0 m-auto animate-spin-medium"
        style={{ animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)', animationDirection: 'reverse', width: '69%', height: '100%' }}
        viewBox="0 0 20 29" fill="none" xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M0 18.4639C1.63181 22.0645 5.35577 24.582 9.69238 24.582C14.025 24.582 17.7457 22.0689 19.3799 18.4736C18.1436 24.4311 14.2757 28.7791 9.69141 28.7793C5.1044 28.7793 1.23406 24.4265 0 18.4639ZM9.69141 0C14.2738 0.000215135 18.1409 4.34433 19.3789 10.2979C17.7439 6.70451 14.0235 4.19336 9.69238 4.19336C5.35713 4.19336 1.63261 6.70877 0 10.3076C1.23576 4.34881 5.10632 0 9.69141 0Z" fill="currentColor"/>
      </svg>

      {/* Layer 3 - Inner crescents */}
      <svg
        className="absolute inset-0 m-auto animate-spin-fast"
        style={{ animationTimingFunction: 'cubic-bezier(0.33, 1, 0.68, 1)', width: '48%', height: '48%' }}
        viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M1.05469 5.26953C0.904664 5.77406 0.824941 6.30709 0.828125 6.8584C0.846131 9.97427 3.48068 12.4854 6.71289 12.4668C7.61943 12.4616 8.47633 12.2566 9.24023 11.8975C6.49156 13.9331 3.21667 14.2704 1.34375 12.5127C-0.383419 10.8917 -0.408551 7.96742 1.05469 5.26953ZM4.12793 1.74707C6.87535 -0.284546 10.148 -0.618701 12.0195 1.1377C13.7496 2.76158 13.7708 5.69278 12.2998 8.39453C12.4528 7.88552 12.5364 7.34786 12.5332 6.79102C12.5152 3.67509 9.87974 1.16395 6.64746 1.18262C5.74413 1.18789 4.88977 1.39029 4.12793 1.74707Z" fill="currentColor"/>
      </svg>
    </div>
  );
}
