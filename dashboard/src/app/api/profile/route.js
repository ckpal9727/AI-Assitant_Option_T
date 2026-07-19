import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PROFILE_PATH = path.resolve(process.cwd(), '../user_profile.json');

function readProfile() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      const data = fs.readFileSync(PROFILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading user_profile.json:', err);
  }
  return {};
}

function writeProfile(data) {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing user_profile.json:', err);
    return false;
  }
}

export async function GET() {
  const profile = readProfile();
  return NextResponse.json({ success: true, profile });
}

export async function POST(request) {
  try {
    const newProfile = await request.json();
    const currentProfile = readProfile();
    const updated = { ...currentProfile, ...newProfile };
    writeProfile(updated);
    return NextResponse.json({ success: true, profile: updated });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
