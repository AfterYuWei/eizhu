//! SOCKS5 TCP CONNECT; domain names are forwarded without local DNS resolution.
use super::transport::ConnectedRoute;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    time::{timeout, Duration},
};

async fn reply(stream: &mut (impl AsyncWrite + Unpin), code: u8) -> std::io::Result<()> {
    stream.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await
}
async fn negotiate(
    stream: &mut (impl AsyncRead + AsyncWrite + Unpin),
) -> std::io::Result<Option<(String, u16)>> {
    let mut greeting = [0; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting[0] != 5 {
        return Ok(None);
    }
    let mut methods = vec![0; usize::from(greeting[1])];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        stream.write_all(&[5, 255]).await?;
        return Ok(None);
    }
    stream.write_all(&[5, 0]).await?;
    let mut request = [0; 4];
    stream.read_exact(&mut request).await?;
    if request[0] != 5 || request[2] != 0 {
        reply(stream, 1).await?;
        return Ok(None);
    }
    if request[1] != 1 {
        reply(stream, 7).await?;
        return Ok(None);
    }
    let host = match request[3] {
        1 => {
            let mut ip = [0; 4];
            stream.read_exact(&mut ip).await?;
            Ipv4Addr::from(ip).to_string()
        }
        4 => {
            let mut ip = [0; 16];
            stream.read_exact(&mut ip).await?;
            Ipv6Addr::from(ip).to_string()
        }
        3 => {
            let length = stream.read_u8().await?;
            let mut domain = vec![0; usize::from(length)];
            stream.read_exact(&mut domain).await?;
            match String::from_utf8(domain) {
                Ok(host)
                    if !host.is_empty()
                        && host.len() <= 253
                        && host
                            .chars()
                            .all(|c| c.is_alphanumeric() || "-._".contains(c)) =>
                {
                    host
                }
                _ => {
                    reply(stream, 4).await?;
                    return Ok(None);
                }
            }
        }
        _ => {
            reply(stream, 8).await?;
            return Ok(None);
        }
    };
    let port = stream.read_u16().await?;
    if port == 0 {
        reply(stream, 1).await?;
        return Ok(None);
    }
    Ok(Some((host, port)))
}
pub(super) async fn relay(
    mut stream: TcpStream,
    peer: SocketAddr,
    route: &ConnectedRoute,
) -> Result<(), String> {
    let Some((host, port)) = timeout(Duration::from_secs(30), negotiate(&mut stream))
        .await
        .map_err(|_| "SOCKS5 握手超时".to_string())?
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    let channel = timeout(
        Duration::from_secs(30),
        route.handle.channel_open_direct_tcpip(
            host,
            u32::from(port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        ),
    )
    .await;
    let channel = match channel {
        Ok(Ok(channel)) => channel,
        Ok(Err(error)) => {
            let _ = reply(&mut stream, 5).await;
            return Err(format!("SOCKS5 目标连接失败：{error}"));
        }
        Err(_) => {
            let _ = reply(&mut stream, 4).await;
            return Err("SOCKS5 目标连接超时".into());
        }
    };
    reply(&mut stream, 0).await.map_err(|e| e.to_string())?;
    let mut remote = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut remote)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn parse(bytes: Vec<u8>) -> (Option<(String, u16)>, Vec<u8>) {
        let (mut client, mut server) = tokio::io::duplex(64);
        let job = tokio::spawn(async move { negotiate(&mut server).await.unwrap() });
        for byte in bytes {
            client.write_all(&[byte]).await.unwrap();
            tokio::task::yield_now().await;
        }
        client.shutdown().await.unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        (job.await.unwrap(), response)
    }
    #[tokio::test]
    async fn fragmented_domain_ipv4_ipv6_and_invalid_requests() {
        let mut domain = vec![5, 1, 0, 5, 1, 0, 3, 20];
        domain.extend(b"ssh-only.invalid.tld");
        domain.extend([1, 187]);
        let (target, response) = parse(domain).await;
        assert_eq!(target, Some(("ssh-only.invalid.tld".into(), 443)));
        assert_eq!(response, [5, 0]);
        let (target, _) = parse(vec![5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1, 0, 80]).await;
        assert_eq!(target, Some(("127.0.0.1".into(), 80)));
        let mut ipv6 = vec![5, 1, 0, 5, 1, 0, 4];
        ipv6.extend(Ipv6Addr::LOCALHOST.octets());
        ipv6.extend([0, 80]);
        assert_eq!(parse(ipv6).await.0, Some(("::1".into(), 80)));
        for command in [2, 3] {
            let (_, response) = parse(vec![5, 1, 0, 5, command, 0, 1]).await;
            assert_eq!(response[3], 7);
        }
        assert_eq!(parse(vec![5, 1, 2]).await.1, [5, 255]);
        assert_eq!(parse(vec![5, 0]).await.1, [5, 255]);
        assert!(parse(vec![4, 1]).await.1.is_empty());
        for (request, code) in [
            (vec![5, 1, 0, 5, 1, 1, 1], 1),
            (vec![5, 1, 0, 5, 1, 0, 9], 8),
            (vec![5, 1, 0, 5, 1, 0, 3, 0], 4),
            (vec![5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1, 0, 0], 1),
        ] {
            assert_eq!(parse(request).await.1[3], code);
        }
    }
}
