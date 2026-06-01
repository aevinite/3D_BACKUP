"use client";

export default function ChefCallButton() {
  return (
    <div className="chef-call" onClick={() => window.dispatchEvent(new Event("lfh:chef-call"))}>
      <i className="fas fa-bell-concierge"></i>
    </div>
  );
}
