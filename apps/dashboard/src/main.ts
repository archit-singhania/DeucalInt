import 'zone.js';
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { enableProdMode } from '@angular/core';
import { AppComponent } from './app';
import './styles.css';
if (import.meta.env.PROD) enableProdMode();
bootstrapApplication(AppComponent).catch(console.error);
