//! Microphone capture (default input device) converted to 16 kHz mono for Whisper.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream};

use super::vad::SAMPLE_RATE;

/// Streaming downsampler to 16 kHz: averages the input samples of each output period (a box
/// filter, enough anti-aliasing for speech recognition) with fractional stepping.
pub struct Resampler {
    step: f64,
    phase: f64,
    sum: f32,
    count: u32,
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        Self { step: f64::from(input_rate) / SAMPLE_RATE as f64, phase: 0.0, sum: 0.0, count: 0 }
    }

    pub fn process(&mut self, input: &[f32], output: &mut Vec<f32>) {
        for &sample in input {
            self.sum += sample;
            self.count += 1;
            self.phase += 1.0;
            if self.phase >= self.step {
                let value = self.sum / self.count as f32;
                // More than one output per input only when upsampling (input below 16 kHz).
                while self.phase >= self.step {
                    output.push(value);
                    self.phase -= self.step;
                }
                self.sum = 0.0;
                self.count = 0;
            }
        }
    }
}

/// An open input stream; capture stops when it is dropped.
pub struct Capture {
    _stream: Stream,
    pub sample_rate: u32,
}

/// Opens the default microphone. Each callback sends one buffer of mono samples (native rate);
/// `device_lost` is raised if the stream fails (e.g. the microphone is unplugged).
pub fn open(sender: Sender<Vec<f32>>, device_lost: Arc<AtomicBool>) -> Result<Capture, String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| "Nenhum microfone encontrado".to_string())?;
    let config = device.default_input_config().map_err(|e| format!("Microfone indisponível: {e}"))?;
    let sample_rate = config.sample_rate();
    let channels = usize::from(config.channels()).max(1);
    let stream_config = config.config();

    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, stream_config, channels, sender, device_lost),
        SampleFormat::I16 => build::<i16>(&device, stream_config, channels, sender, device_lost),
        SampleFormat::I32 => build::<i32>(&device, stream_config, channels, sender, device_lost),
        SampleFormat::U16 => build::<u16>(&device, stream_config, channels, sender, device_lost),
        SampleFormat::U8 => build::<u8>(&device, stream_config, channels, sender, device_lost),
        other => return Err(format!("Formato de áudio não suportado: {other}")),
    }
    .map_err(|e| format!("Microfone indisponível: {e}"))?;

    stream.play().map_err(|e| format!("Microfone indisponível: {e}"))?;
    Ok(Capture { _stream: stream, sample_rate })
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    sender: Sender<Vec<f32>>,
    device_lost: Arc<AtomicBool>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|frame| frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / channels as f32)
                .collect();
            // The receiver is gone when the engine stops; the stream is dropped right after.
            let _ = sender.send(mono);
        },
        move |error: cpal::Error| {
            use cpal::ErrorKind::*;
            // Glitches (xruns) and default-device reroutes are recoverable; these are not.
            if matches!(error.kind(), DeviceNotAvailable | HostUnavailable | PermissionDenied | StreamInvalidated) {
                device_lost.store(true, Ordering::Relaxed);
            }
        },
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsamples_to_16k() {
        for rate in [48_000u32, 44_100, 32_000, 16_000] {
            let mut resampler = Resampler::new(rate);
            let mut output = Vec::new();
            // One second fed in uneven chunks.
            let input = vec![0.5f32; rate as usize];
            for chunk in input.chunks(997) {
                resampler.process(chunk, &mut output);
            }
            assert!((output.len() as i64 - 16_000).abs() <= 1, "{rate} Hz → {}", output.len());
            assert!(output.iter().all(|s| (s - 0.5).abs() < 1e-6));
        }
    }

    #[test]
    fn upsamples_low_rates() {
        let mut resampler = Resampler::new(8_000);
        let mut output = Vec::new();
        resampler.process(&vec![0.25f32; 8_000], &mut output);
        assert!((output.len() as i64 - 16_000).abs() <= 1);
    }
}
