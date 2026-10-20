//! Tunnel connection streams are cancelled and joined even before a Handle is returned.
use super::transport::BoxStream;
use std::{
    future::Future,
    io,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::oneshot,
    time::timeout,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub(super) struct ConnectionScope {
    pub cancel: CancellationToken,
    streams: Arc<Mutex<Vec<oneshot::Receiver<()>>>>,
}
impl ConnectionScope {
    pub fn new() -> Self {
        Self {
            cancel: CancellationToken::new(),
            streams: Arc::new(Mutex::new(Vec::new())),
        }
    }
    pub fn wrap(&self, stream: BoxStream) -> BoxStream {
        let (closed, receiver) = oneshot::channel();
        self.streams
            .lock()
            .expect("connection streams")
            .push(receiver);
        Box::new(CancelledStream {
            stream,
            cancelled: Box::pin(self.cancel.clone().cancelled_owned()),
            closed: Some(closed),
        })
    }
    pub async fn finish(&self) {
        self.cancel.cancel();
        let receivers = std::mem::take(&mut *self.streams.lock().expect("connection streams"));
        for receiver in receivers {
            let _ = timeout(Duration::from_secs(5), receiver).await;
        }
    }
}
struct CancelledStream {
    stream: BoxStream,
    cancelled: Pin<Box<dyn Future<Output = ()> + Send>>,
    closed: Option<oneshot::Sender<()>>,
}
impl CancelledStream {
    fn check(&mut self, cx: &mut Context<'_>) -> io::Result<()> {
        if self.cancelled.as_mut().poll(cx).is_ready() {
            Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "隧道连接已取消",
            ))
        } else {
            Ok(())
        }
    }
}
impl Drop for CancelledStream {
    fn drop(&mut self) {
        if let Some(closed) = self.closed.take() {
            let _ = closed.send(());
        }
    }
}
impl AsyncRead for CancelledStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if let Err(error) = self.check(cx) {
            return Poll::Ready(Err(error));
        }
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}
impl AsyncWrite for CancelledStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if let Err(error) = self.check(cx) {
            return Poll::Ready(Err(error));
        }
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Err(error) = self.check(cx) {
            return Poll::Ready(Err(error));
        }
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}
