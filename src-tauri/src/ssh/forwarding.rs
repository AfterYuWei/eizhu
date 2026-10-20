//! Accept only registered remote channels, with a bound shared by queued and active relays.
use russh::{client, Channel};
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};

pub(super) struct ForwardedChannel {
    pub channel: Channel<client::Msg>,
    pub permit: OwnedSemaphorePermit,
}
#[derive(Clone)]
pub(super) struct ForwardingRegistration {
    expected: Arc<Mutex<Option<SocketAddr>>>,
    sender: mpsc::Sender<ForwardedChannel>,
    permits: Arc<Semaphore>,
}
impl ForwardingRegistration {
    pub fn new() -> (Self, mpsc::Receiver<ForwardedChannel>) {
        let (sender, receiver) = mpsc::channel(32);
        (
            Self {
                expected: Arc::new(Mutex::new(None)),
                sender,
                permits: Arc::new(Semaphore::new(32)),
            },
            receiver,
        )
    }
    pub fn set_address(&self, address: Option<SocketAddr>) {
        *self.expected.lock().expect("forwarding registration") = address;
    }
    pub async fn accept(
        &self,
        channel: Channel<client::Msg>,
        host: &str,
        port: u32,
        reply: client::ChannelOpenHandle,
    ) {
        let Ok(ip) = host.parse() else { return };
        let Ok(port) = u16::try_from(port) else {
            return;
        };
        if !self
            .expected
            .lock()
            .expect("forwarding registration")
            .is_some_and(|expected| expected == SocketAddr::new(ip, port))
        {
            return;
        }
        let Ok(permit) = self.permits.clone().try_acquire_owned() else {
            return;
        };
        let Ok(slot) = self.sender.clone().try_reserve_owned() else {
            return;
        };
        reply.accept().await;
        slot.send(ForwardedChannel { channel, permit });
    }
}
