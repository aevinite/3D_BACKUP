// "use client" tells Next.js this is an interactive piece that runs in the
// visitor's browser (it can respond to taps), not just pre-built on the server.
"use client";

// ChefCallButton: the little "ring the bell" button. When a guest taps it, it
// shouts a message ("lfh:chef-call") out to the rest of the app, and whatever
// part of the app is listening for that message handles calling the waiter.
export default function ChefCallButton() {
  return (
    // The bell-shaped button. onClick = "when tapped".
    // dispatchEvent here is like ringing a bell the whole app can hear: it sends
    // out the "lfh:chef-call" signal so another component can react to it.
    <div className="chef-call" onClick={() => window.dispatchEvent(new Event("lfh:chef-call"))}>
      {/* This <i> is just the bell icon (from the Font Awesome icon set). */}
      <i className="fas fa-bell-concierge"></i>
    </div>
  );
}
